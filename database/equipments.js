// Original demo items. Amounts are integer cents; icons are temporary until the catalog art stage.
const items = [
  ['晨星长剑', 12900, 'R', 'weapon', 68, 0, 24, '剑脊镶嵌微光晶石。适合初入远征的剑士，兼顾锋利与轻便。'],
  ['灰烬巨刃', 45900, 'SR', 'weapon', 182, 12, 8, '以熔岩锻成的重刃。攻击时留下灼热余烬，适合正面突破。'],
  ['霜月长弓', 89900, 'SSR', 'weapon', 256, 0, 1, '弓弦凝结月光，箭矢附着寒霜。为远距离狩猎而打造。'],
  ['旅者短刀', 2900, 'N', 'weapon', 24, 0, 60, '便于随身携带的短刀，可用于营地作业与近身防御。'],
  ['守夜轻甲', 3900, 'R', 'armor', 0, 58, 30, '覆盖关键部位的轻甲。行动灵活，适合长途探索。'],
  ['磐岩胸铠', 32900, 'SR', 'armor', 0, 176, 12, '层叠岩钢甲片分散冲击，为前排守卫提供稳固防护。'],
  ['星辉法袍', 79900, 'SSR', 'armor', 36, 210, 3, '以星丝织就的长袍，为施法者提供防护与法术增幅。'],
  ['旧革护衣', 1900, 'N', 'armor', 0, 22, 80, '经过修补的旅行护衣，为新手提供基础防护。'],
  ['风语指环', 5900, 'R', 'accessory', 16, 8, 28, '带有风纹的银环。佩戴后让动作更加轻盈。'],
  ['赤曜吊坠', 24900, 'SR', 'accessory', 48, 20, 6, '吊坠内封存温热晶核，为佩戴者提供进攻属性增益。'],
  ['时隙徽记', 99900, 'SSR', 'accessory', 72, 64, 0, '远征者传承的徽记，据说能捕捉时间流动中的一瞬。'],
  ['铜质护符', 1500, 'N', 'accessory', 0, 8, 100, '刻有祝福符号的铜牌，提供微弱但稳定的防护。'],
  ['生命药剂', 800, 'N', 'consumable', 0, 0, 200, '使用后恢复角色生命值。适合远征前补充携带。'],
  ['专注药剂', 2200, 'R', 'consumable', 0, 0, 45, '使用后短时间内提升专注程度，适合连续施法。'],
  ['复苏晶石', 15900, 'SR', 'consumable', 0, 0, 4, '蕴含复苏力量的晶体，可用于营地恢复与远征补给。'],
  ['星门信标', 59900, 'SSR', 'consumable', 0, 0, 5, '用于开启临时星门的信标。当前批次暂未开放兑换。', 'off_sale'],
];

export const demoEquipments = items.map(([name, price, rarity, category, attack, defense, stock, description, status = 'on_sale']) => ({
  name, price, rarity, category, attack, defense, stock, description, status,
  image: '/images/equipments/placeholder.svg',
}));
