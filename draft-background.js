/* Trusted message router. Domain data belongs to the extension offscreen IndexedDB. */
globalThis.DraftBackground = (() => {
  const pages = ["library.html", "popup.html", "settings.html"];
  let creating;
  let nativeBusy = false;
  function extensionPage(sender) {
    return (
      sender.id === chrome.runtime.id &&
      pages.some((p) => sender.url?.split("?")[0] === chrome.runtime.getURL(p))
    );
  }
  function trustedSender(sender) {
    return (
      extensionPage(sender) ||
      (sender.id === chrome.runtime.id &&
        sender.tab &&
        /^https?:\/\//.test(sender.url || ""))
    );
  }
  async function ensureHost() {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("draft-host.html")],
    });
    if (contexts.length) return;
    if (!creating) {
      creating = chrome.offscreen
        .createDocument({
          url: "draft-host.html",
          reasons: ["DOM_PARSER", "BLOBS"],
          justification:
            "Validate and sanitize local drafts and manage local content-package files.",
        })
        .finally(() => {
          creating = null;
        });
    }
    await creating;
  }
  async function gateway(request, context = { source: "user" }) {
    await ensureHost();
    const result = await chrome.runtime.sendMessage({
      target: "draft-host",
      type: "draft-host-request",
      request,
      context,
    });
    if (!result) throw new Error("稿件服务未就绪，请重试同一个 requestId");
    return result;
  }
  function native(payload) {
    return new Promise((resolve, reject) =>
      chrome.runtime.sendNativeMessage(
        "com.yunzhongshu.clipbridge",
        payload,
        (r) => {
          if (chrome.runtime.lastError)
            reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        },
      ),
    );
  }
  async function ai(p) {
    const config = await chrome.storage.local.get([
      "allowAIDraftWrites",
      "aiEndpoint",
      "aiApiKey",
      "aiModel",
      "aiProvider",
    ]);
    if (config.allowAIDraftWrites !== true)
      throw new Error("请启用“允许 AI 写入本地稿件库”");
    if (!config.aiEndpoint || !config.aiApiKey || !config.aiModel)
      throw new Error("请先在插件设置中配置 AI 服务");
    if (
      typeof p.instruction !== "string" ||
      !p.instruction.trim() ||
      p.instruction.length > 20000 ||
      !p.requestId
    )
      throw new Error("AI 指令或任务身份无效");
    const runId = `ai_${p.requestId}`;
    const oldRuns = await gateway({ type: "drafts.aiRuns", payload: {} });
    const old = oldRuns.runs?.find((r) => r.id === runId);
    if (old)
      return {
        ok: old.status === "completed",
        run: old,
        error:
          old.status === "completed"
            ? undefined
            : "该任务已提交，状态可能未知；请检查任务记录，使用新任务 ID 明确重试。",
      };
    let draft;
    if (p.draftId) {
      const r = await gateway({
        type: "drafts.get",
        payload: { draftId: p.draftId },
      });
      if (!r.ok) throw new Error(r.error);
      draft = r.draft;
    }
    const run = {
      id: runId,
      draftId: p.draftId,
      provider: config.aiProvider || "custom",
      model: config.aiModel,
      instruction: p.instruction,
      inputRevisionId: draft?.currentRevisionId,
      startedAt: Date.now(),
      status: "running",
    };
    const reservation = await gateway({
      type: "drafts.beginAIRun",
      payload: run,
    });
    if (!reservation.ok) throw new Error(reservation.error);
    if (!reservation.created)
      return {
        ok: reservation.run.status === "completed",
        run: reservation.run,
        error: "该任务已提交，请检查现有任务，不会自动重试。",
      };
    const mode = p.mode || (draft ? "update" : "create");
    try {
      const schema =
        '只返回 JSON：{"reply":"...","actions":[{"type":"drafts.create","payload":{"draft":{"title":"...","contentMarkdown":"...","contentHtml":"...","summary":"...","tags":[]}}}]}。可用动作：drafts.create、drafts.update、drafts.createRevision、drafts.createTargetVariant。更新 payload 必须含 draftId、baseRevisionId、expectedChecksum、changes。createTargetVariant 还需 platformId。正文必须完整。最多 4 个动作。不得删除、归档、平台导出、保存或发布。';
      const messages = [
        {
          role: "system",
          content:
            schema +
            " mode=create/copy 只能新建稿件；update 只能修改当前稿件；summary 只能更新当前稿件 summary/tags；variant 只能创建 wechat-official-account 适配版本。Markdown 和 HTML 同时给出时必须一致，建议只给其中一种。针对现有稿件一次最多一个动作。",
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction: p.instruction,
            currentDraft: draft || null,
            mode,
          }),
        },
      ];
      const response = await fetch(config.aiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.aiApiKey}`,
        },
        body: JSON.stringify({
          model: config.aiModel,
          messages,
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok)
        throw new Error(`AI 请求失败（HTTP ${response.status}）`);
      const output = await response.json();
      let text = output.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.length > 4 * 1024 * 1024)
        throw new Error("AI 未返回有效结构化内容");
      if (text.includes(config.aiApiKey))
        throw new Error("AI 输出包含敏感凭据，已拒绝保存");
      text = text
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, "");
      const data = JSON.parse(text);
      if (
        !Array.isArray(data.actions) ||
        !data.actions.length ||
        data.actions.length > 4
      )
        throw new Error("AI 没有返回正式稿件动作");
      const actions = [];
      if (
        draft &&
        !["copy", "create"].includes(mode) &&
        data.actions.length !== 1
      )
        throw new Error("修改同一稿件一次只能提交一个完整动作");
      // Check declared types and draft identity before accepting writes.
      for (const [i, action] of data.actions.entries()) {
        if (
          ![
            "drafts.create",
            "drafts.update",
            "drafts.createRevision",
            "drafts.createTargetVariant",
          ].includes(action.type) ||
          !action.payload
        )
          throw new Error("AI 返回了未声明的动作");
        if (
          action.type !== "drafts.create" &&
          (!draft ||
            action.payload.draftId !== draft.id ||
            action.payload.baseRevisionId !== draft.currentRevisionId ||
            action.payload.expectedChecksum !== draft.checksum)
        )
          throw new Error("AI 更新身份或版本不匹配");
        const payload = { ...action.payload, requestId: `${p.requestId}:${i}` };
        const candidate =
          action.type === "drafts.create"
            ? payload.draft || payload
            : {
                ...draft,
                ...payload.changes,
                ...(payload.changes?.contentMarkdown !== undefined &&
                payload.changes?.contentHtml === undefined
                  ? { contentHtml: undefined }
                  : {}),
              };
        const validated = await gateway({
          type: "drafts.validate",
          payload: {
            draft: candidate,
            request: { type: action.type, payload },
          },
        });
        if (!validated.ok) throw new Error(validated.error);
        if (
          draft &&
          ["update", "summary"].includes(mode) &&
          action.type === "drafts.create"
        )
          throw new Error("修改模式不允许创建另一篇稿件");
        if (
          ["create", "copy"].includes(mode) &&
          action.type !== "drafts.create"
        )
          throw new Error("新建或另存模式必须创建新稿件");
        if (mode === "variant" && action.type !== "drafts.createTargetVariant")
          throw new Error("平台版本模式必须返回正式适配版本");
        if (
          mode === "summary" &&
          Object.keys(payload.changes || {}).some(
            (k) => !["summary", "tags"].includes(k),
          )
        )
          throw new Error("摘要模式只能修改摘要和标签");
        actions.push({ type: action.type, payload });
      }
      run.results = [];
      for (const action of actions) {
        const r = await gateway(action, {
          source: "ai",
          allowAI: true,
          aiRunId: runId,
        });
        run.results.push(r);
        if (!r.ok) throw new Error(r.error);
        await gateway({ type: "drafts.aiRun", payload: run });
      }
      run.status = "completed";
      run.reply = String(data.reply || "已保存到本地稿件库").slice(0, 5000);
      run.outputRevisionIds = run.results.map((r) => r.revisionId);
      run.usage = output.usage
        ? {
            input: output.usage.prompt_tokens || 0,
            output: output.usage.completion_tokens || 0,
          }
        : undefined;
    } catch (e) {
      run.status = "failed";
      run.error =
        e.name === "TimeoutError"
          ? "AI 请求超时，未自动重试"
          : String(e.message)
              .replaceAll(config.aiApiKey, "[已隐藏]")
              .slice(0, 1000);
    }
    run.finishedAt = Date.now();
    await gateway({ type: "drafts.aiRun", payload: run });
    return { ok: run.status === "completed", run, error: run.error };
  }
  async function pollNative() {
    if (nativeBusy) return;
    const c = await chrome.storage.local.get([
      "draftGatewayEnabled",
      "allowAIDraftWrites",
    ]);
    if (!c.draftGatewayEnabled || !c.allowAIDraftWrites) return;
    nativeBusy = true;
    try {
      const packet = await native({ action: "draft-gateway-poll" });
      if (!packet?.ok)
        throw new Error(packet?.error || "本地网关没有响应，请升级组件");
      if (packet?.request) {
        const runId = `agent_${packet.requestId}`;
        const started = Date.now();
        const result = await gateway(packet.request, {
          source: "agent",
          allowAI: true,
          aiRunId: runId,
        });
        await gateway({
          type: "drafts.aiRun",
          payload: {
            id: runId,
            provider: "native-agent",
            model:
              packet.request.payload?.draft?.provenance?.model || "external",
            instruction: packet.request.type,
            draftId: result.draftId,
            inputRevisionId: packet.request.payload?.baseRevisionId,
            outputRevisionIds: result.revisionId ? [result.revisionId] : [],
            startedAt: started,
            finishedAt: Date.now(),
            status: result.ok ? "completed" : "failed",
            error: result.error,
          },
        });
        await native({
          action: "draft-gateway-ack",
          requestId: packet.requestId,
          result,
        });
      }
    } finally {
      nativeBusy = false;
    }
  }
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "draft-gateway") pollNative().catch(() => {});
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      ![
        "draft-api",
        "draft-ai",
        "draft-gateway-enable",
        "draft-export-editor",
        "draft-read-editor",
        "draft-poll-native",
        "draft-confirm-reopened",
      ].includes(message?.type)
    )
      return false;
    if (!extensionPage(sender)) {
      respond({ ok: false, code: "FORBIDDEN", error: "仅允许扩展管理页面" });
      return false;
    }
    const run = async () => {
      if (message.type === "draft-api") return gateway(message.request);
      if (message.type === "draft-ai") return ai(message.payload || {});
      if (message.type === "draft-gateway-enable") {
        if (message.enabled === true) {
          const c = await chrome.storage.local.get("allowAIDraftWrites");
          if (!c.allowAIDraftWrites) throw new Error("请先允许 AI 写入");
          const init = await native({ action: "draft-gateway-init" });
          if (!init?.ok) throw new Error(init?.error || "本地组件需要升级");
          await chrome.storage.local.set({ draftGatewayEnabled: true });
          await chrome.alarms.create("draft-gateway", { periodInMinutes: 1 });
          return { ok: true, directory: init.directory };
        }
        await chrome.storage.local.set({ draftGatewayEnabled: false });
        await chrome.alarms.clear("draft-gateway");
        return { ok: true };
      }
      if (message.type === "draft-poll-native") {
        await pollNative();
        return { ok: true };
      }
      if (!Number.isInteger(message.tabId))
        throw new Error("请指定目标编辑器标签页");
      if (message.type === "draft-read-editor")
        return chrome.tabs.sendMessage(message.tabId, {
          type: "draft-editor-readback",
        });
      if (message.type === "draft-confirm-reopened") {
        if (message.confirmed !== true)
          throw new Error("请先确认已保存后重新打开");
        const actual = await chrome.tabs.sendMessage(message.tabId, {
          type: "draft-editor-readback",
        });
        if (!actual?.ok) throw new Error(actual?.error || "图片回读失败");
        return gateway({
          type: "drafts.confirmReopened",
          payload: {
            draftId: message.draftId,
            receiptId: message.receiptId,
            title: actual.snapshot.title,
            images: actual.snapshot.images,
            confirmed: true,
          },
        });
      }
      // Content script requires explicit user approval and performs its own overwrite confirmation.
      if (message.confirmed !== true) throw new Error("导出必须由用户主动确认");
      const r = await gateway({
        type: "drafts.get",
        payload: { draftId: message.draftId },
      });
      if (!r.ok) return r;
      const draft = r.draft;
      if (draft.currentRevisionId !== message.revisionId)
        throw new Error("稿件版本已变化，请重新选择");
      const variant = draft.targetVariants["wechat-official-account"];
      const content =
        variant?.revisionId === draft.currentRevisionId ? variant : draft;
      const a = await gateway({
        type: "drafts.assetList",
        payload: { hashes: draft.assetIds },
      });
      let html = content.contentHtml;
      const warnings = [];
      for (const asset of a.assets || []) {
        const mapping = asset.platformMappings["wechat-official-account"];
        if (mapping?.url)
          html = html.replaceAll(`asset://${asset.sha256}`, mapping.url);
        else
          warnings.push(
            `图片/附件 ${asset.sha256.slice(0, 8)} 需先上传到平台并映射`,
          );
      }
      const prepared = await gateway({
        type: "drafts.recordExport",
        payload: {
          draftId: draft.id,
          revisionId: draft.currentRevisionId,
          platformId: "wechat-official-account",
          status: "prepared",
          warnings,
        },
      });
      let result;
      try {
        result = await chrome.tabs.sendMessage(message.tabId, {
          type: "draft-editor-export",
          variant: { title: content.title, contentHtml: html },
          confirmed: true,
        });
      } catch (e) {
        result = {
          ok: false,
          error: "目标页未收到导出请求，请打开微信图文编辑页并刷新扩展脚本",
        };
      }
      const receipt = await gateway({
        type: "drafts.recordExport",
        payload: {
          ...prepared.receipt,
          status: result?.ok ? "verified" : "failed",
          exportedTitle: result?.snapshot?.title,
          exportedHtmlChecksum: result?.verification?.expectedChecksum,
          readBackHtmlChecksum: result?.verification?.actualChecksum,
          warnings: [...warnings, ...(result?.warnings || [])],
          error: result?.error,
        },
      });
      if (result?.ok)
        await gateway({
          type: "drafts.markAssetsExported",
          payload: { draftId: draft.id, receiptId: receipt.receipt.id },
        });
      return { ...result, receipt: receipt.receipt };
    };
    run()
      .then(respond)
      .catch((e) =>
        respond({
          ok: false,
          code: e.code || "GATEWAY_ERROR",
          error: e.message,
        }),
      );
    return true;
  });
  return { trustedSender, extensionPage };
})();
