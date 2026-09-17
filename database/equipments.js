const image = (name) => `/images/equipments/${name}.png`;

const original = [
  ['晨星长剑', 12900, 'R', 'weapon', 68, 0, 24, '剑脊镶嵌微光晶石。适合初入远征的剑士，兼顾锋利与轻便。', 'morningstar-sword'],
  ['灰烬巨刃', 45900, 'SR', 'weapon', 182, 12, 8, '以熔岩锻成的重刃。攻击时留下灼热余烬，适合正面突破。', 'ash-greatblade'],
  ['霜月长弓', 89900, 'SSR', 'weapon', 256, 0, 1, '弓弦凝结月光，箭矢附着寒霜。为远距离狩猎而打造。', 'frostmoon-bow'],
  ['旅者短刀', 2900, 'N', 'weapon', 24, 0, 60, '便于随身携带的短刀，可用于营地作业与近身防御。', 'traveler-dagger'],
  ['守夜轻甲', 3900, 'R', 'armor', 0, 58, 30, '覆盖关键部位的轻甲。行动灵活，适合长途探索。', 'nightwatch-light-armor'],
  ['磐岩胸铠', 32900, 'SR', 'armor', 0, 176, 12, '层叠岩钢甲片分散冲击，为前排守卫提供稳固防护。', 'bedrock-chestplate'],
  ['星辉法袍', 79900, 'SSR', 'armor', 36, 210, 3, '以星丝织就的长袍，为施法者提供防护与法术增幅。', 'starlight-robe'],
  ['旧革护衣', 1900, 'N', 'armor', 0, 22, 80, '经过修补的旅行护衣，为新手提供基础防护。', 'worn-leather-armor'],
  ['风语指环', 5900, 'R', 'accessory', 16, 8, 28, '带有风纹的银环。佩戴后让动作更加轻盈。', 'windwhisper-ring'],
  ['赤曜吊坠', 24900, 'SR', 'accessory', 48, 20, 6, '吊坠内封存温热晶核，为佩戴者提供进攻属性增益。', 'redsun-pendant'],
  ['时隙徽记', 99900, 'SSR', 'accessory', 72, 64, 0, '远征者传承的徽记，据说能捕捉时间流动中的一瞬。', 'timeslit-emblem'],
  ['铜质护符', 1500, 'N', 'accessory', 0, 8, 100, '刻有祝福符号的铜牌，提供微弱但稳定的防护。', 'copper-talisman'],
  ['生命药剂', 800, 'N', 'consumable', 0, 0, 200, '使用后恢复角色生命值。适合远征前补充携带。', 'health-potion'],
  ['专注药剂', 2200, 'R', 'consumable', 0, 0, 45, '使用后短时间内提升专注程度，适合连续施法。', 'focus-potion'],
  ['复苏晶石', 15900, 'SR', 'consumable', 0, 0, 4, '蕴含复苏力量的晶体，可用于营地恢复与远征补给。', 'revival-crystal'],
  ['星门信标', 59900, 'SSR', 'consumable', 0, 0, 4, '用于开启临时星门的信标。当前批次暂未开放兑换。', 'stargate-beacon'],
];

const eclipse = [
  ['日蚀刃', 8900, 'R', 'weapon', 54, 6, 18, '以白金圣械工艺锻造的短刃，剑脊内部流动着琥珀色日蚀能量，适合快速突袭与仪式决斗。', 'eclipse-blade'],
  ['赫利俄斯长枪', 18900, 'SR', 'weapon', 96, 12, 9, '长枪核心嵌有太阳熔炉式能量节点，枪尖在蓄能时会浮现橙金色光辉，是日蚀圣械中的标准精锐兵装。', 'helios-lance'],
  ['曜日壁垒', 24900, 'SR', 'armor', 18, 148, 7, '胸甲主体采用白色圣械陶瓷与暗金加固骨架，胸前嵌有日蚀核心，可提供持续防护与稳定能量屏障。', 'solar-bulwark'],
  ['日冕指环', 9900, 'R', 'accessory', 14, 10, 22, '一枚以白金结构包裹微型琥珀核心的古老指环，在战斗中可持续调节佩戴者的能量流动。', 'corona-ring'],
  ['黎明核心', 15900, 'SR', 'consumable', 0, 0, 14, '用于驱动日蚀圣械的能源核心，内部封存高纯度光能，在激活时会释放温暖而稳定的橙色脉冲。', 'dawn-core'],
  ['天穹圣器', 49900, 'SSR', 'consumable', 68, 52, 3, '日蚀圣械系列中的高阶遗物，外壳由白色圣械材质与古金结构构成，内部核心蕴含近乎恒星级的光能。', 'celestial-relic'],
];

const abyssal = [
  ['渊牙短刃', 7900, 'R', 'weapon', 48, 4, 24, '由幽渊遗迹中回收的黑曜质刃材重铸而成，\n刀脊内部封存微弱的翠绿色幽能，\n在高速挥动时会留下短暂的深海荧光轨迹。', 'abyss-fang-dagger'],
  ['潮蚀长镰', 21900, 'SR', 'weapon', 112, 8, 8, '自沉没遗迹深处回收的长柄收割兵器，黑曜质镰刃与深海生物骨骼结构融为一体。刃根封存高密度幽渊能量，挥动时会在空气中留下短暂的翠绿色潮蚀轨迹。', 'tidecorrode-scythe'],
  ['深潜者护甲', 12900, 'R', 'armor', 8, 82, 15, '由深海遗迹中回收的生物机械护甲，外层覆盖黑曜质甲壳与冷银加固骨架，可在高压环境下维持稳定防护，并持续导出微量幽渊能量。', 'deepdiver-armor'],
  ['潮汐指环', 8900, 'R', 'accessory', 12, 14, 20, '由幽渊遗迹中的潮汐稳定器改制而成，黑曜质环体包裹着微型翠绿色能量核心，可持续调节佩戴者周围的幽能流动。', 'tide-ring'],
  ['深渊之眼', 17900, 'SR', 'accessory', 32, 28, 9, '一枚自幽渊遗迹核心区回收的观测遗物，中央悬浮着持续脉动的翠绿色幽能晶核，据说能够感知周围异常能量并强化佩戴者的战场感知。', 'abyss-eye'],
  ['巨渊胸铠', 45900, 'SSR', 'armor', 20, 188, 4, '由深渊巨型生物的遗骸与古代机械骨架重构而成的重型胸铠，内部封存高密度幽渊核心，可在承受重击时释放稳定的翠绿色防护脉冲。', 'abyssal-bulwark'],
  ['幽能注射剂', 3900, 'R', 'consumable', 0, 0, 36, '以幽渊遗迹中提取的低浓度能量液制成的战术注射剂，可在短时间内稳定身体状态并补充作战所需的幽能储备。', 'abyssal-injector'],
  ['深渊信标', 52900, 'SSR', 'consumable', 62, 48, 3, '幽渊遗械系列中的高阶导航与定位装置，可释放稳定的深海幽能场并与失落遗迹中的远古信号网络产生共鸣。', 'abyssal-beacon'],
];

function toEquipment([name, price, rarity, category, attack, defense, stock, description, imageName], extra = {}) {
  return { name, price, rarity, category, attack, defense, stock, description, status: 'on_sale', image: image(imageName), series_code: null, ...extra };
}

export const demoEquipments = [
  ...original.map((item) => toEquipment(item)),
  ...eclipse.map((item) => toEquipment(item, { newForDays: 14, series_code: 'eclipse_relics' })),
  ...abyssal.map((item) => toEquipment(item, { newForDays: 14, series_code: 'abyssal_remnants' })),
];
