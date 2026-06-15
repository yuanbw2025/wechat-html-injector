// 云中书公众号排版引擎 —— 打包入口（暴露为 window.YunType）
import { renderWechatV2 } from '../../yuntype/src/lib/render/wechat'
import {
  getStyleComboV2, defaultAtomIdsV2, randomAtomIdsV2, getComboNameV2,
  blueprints, colorSchemes, typographySets, TOTAL_COMBOS_V2,
  analyzeArticleTags, recommendPresets,
} from '../../yuntype/src/lib/atoms'

export const YunType = {
  renderWechatV2, getStyleComboV2, defaultAtomIdsV2, randomAtomIdsV2, getComboNameV2,
  blueprints, colorSchemes, typographySets, TOTAL_COMBOS_V2,
  analyzeArticleTags, recommendPresets,
}
;(globalThis as any).YunType = YunType
