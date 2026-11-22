// Sistemas de ficha: Abismo (o do grupo), Ordem Paranormal, D&D 5e, Tormenta20 e
// Personalizado (montado pelo mestre). Cada um tem os próprios atributos, perícias,
// barras e a conta do teste (igual à do servidor, em Server/Sheets.cs).
import { t, getLanguage } from './i18n.js';

const name = (pt, en) => ({ pt, en });

export const BUILT_IN_SYSTEMS = {
  ordem: {
    attributes: { agi: name('AGI', 'AGI'), for: name('FOR', 'STR'), int: name('INT', 'INT'), pre: name('PRE', 'PRE'), vig: name('VIG', 'VIG') },
    attributeDefault: 1,
    skills: [
      ['acrobacia', 'agi', 'Acrobacia', 'Acrobatics'], ['adestramento', 'pre', 'Adestramento', 'Animal Handling'], ['artes', 'pre', 'Artes', 'Arts'],
      ['atletismo', 'for', 'Atletismo', 'Athletics'], ['atualidades', 'int', 'Atualidades', 'Current Events'], ['ciencias', 'int', 'Ciências', 'Sciences'],
      ['crime', 'agi', 'Crime', 'Crime'], ['diplomacia', 'pre', 'Diplomacia', 'Diplomacy'], ['enganacao', 'pre', 'Enganação', 'Deception'],
      ['fortitude', 'vig', 'Fortitude', 'Fortitude'], ['furtividade', 'agi', 'Furtividade', 'Stealth'], ['iniciativa', 'agi', 'Iniciativa', 'Initiative'],
      ['intimidacao', 'pre', 'Intimidação', 'Intimidation'], ['intuicao', 'pre', 'Intuição', 'Insight'], ['investigacao', 'int', 'Investigação', 'Investigation'],
      ['luta', 'for', 'Luta', 'Fighting'], ['medicina', 'int', 'Medicina', 'Medicine'], ['ocultismo', 'int', 'Ocultismo', 'Occultism'],
      ['percepcao', 'pre', 'Percepção', 'Perception'], ['pilotagem', 'agi', 'Pilotagem', 'Piloting'], ['pontaria', 'agi', 'Pontaria', 'Aim'],
      ['profissao', 'int', 'Profissão', 'Profession'], ['reflexos', 'agi', 'Reflexos', 'Reflexes'], ['religiao', 'pre', 'Religião', 'Religion'],
      ['sobrevivencia', 'int', 'Sobrevivência', 'Survival'], ['tatica', 'int', 'Tática', 'Tactics'], ['tecnologia', 'int', 'Tecnologia', 'Technology'],
      ['vontade', 'pre', 'Vontade', 'Will'],
    ],
    stats: { hp: name('PV', 'HP'), ea: name('PE', 'EP'), san: name('SAN', 'SAN') },
    trained: [[0, name('Destreinado', 'Untrained')], [5, name('Treinado +5', 'Trained +5')], [10, name('Veterano +10', 'Veteran +10')], [15, name('Expert +15', 'Expert +15')]],
    level: name('NEX %', 'NEX %'),
    classLabel: name('CLASSE / TRILHA', 'CLASS / PATH'),
    defense: name('DEFESA', 'DEFENSE'),
  },
  dnd: {
    attributes: { str: name('FOR', 'STR'), dex: name('DES', 'DEX'), con: name('CON', 'CON'), int: name('INT', 'INT'), wis: name('SAB', 'WIS'), cha: name('CAR', 'CHA') },
    attributeDefault: 10,
    skills: [
      ['acrobatics', 'dex', 'Acrobacia', 'Acrobatics'], ['animalHandling', 'wis', 'Adestrar Animais', 'Animal Handling'], ['arcana', 'int', 'Arcanismo', 'Arcana'],
      ['athletics', 'str', 'Atletismo', 'Athletics'], ['deception', 'cha', 'Enganação', 'Deception'], ['history', 'int', 'História', 'History'],
      ['insight', 'wis', 'Intuição', 'Insight'], ['intimidation', 'cha', 'Intimidação', 'Intimidation'], ['investigation', 'int', 'Investigação', 'Investigation'],
      ['medicine', 'wis', 'Medicina', 'Medicine'], ['nature', 'int', 'Natureza', 'Nature'], ['perception', 'wis', 'Percepção', 'Perception'],
      ['performance', 'cha', 'Atuação', 'Performance'], ['persuasion', 'cha', 'Persuasão', 'Persuasion'], ['religion', 'int', 'Religião', 'Religion'],
      ['sleightOfHand', 'dex', 'Prestidigitação', 'Sleight of Hand'], ['stealth', 'dex', 'Furtividade', 'Stealth'], ['survival', 'wis', 'Sobrevivência', 'Survival'],
    ],
    stats: { hp: name('PV', 'HP') },
    trained: [[0, name('—', '—')], [1, name('Proficiente', 'Proficient')], [2, name('Especialista', 'Expertise')]],
    level: name('NÍVEL', 'LEVEL'),
    classLabel: name('CLASSE', 'CLASS'),
    defense: name('CA', 'AC'),
  },
  tormenta: {
    attributes: { for: name('FOR', 'STR'), des: name('DES', 'DEX'), con: name('CON', 'CON'), int: name('INT', 'INT'), sab: name('SAB', 'WIS'), car: name('CAR', 'CHA') },
    attributeDefault: 0,
    skills: [
      ['acrobacia', 'des', 'Acrobacia', 'Acrobatics'], ['adestramento', 'car', 'Adestramento', 'Animal Handling'], ['atletismo', 'for', 'Atletismo', 'Athletics'],
      ['atuacao', 'car', 'Atuação', 'Performance'], ['cavalgar', 'des', 'Cavalgar', 'Riding'], ['conhecimento', 'int', 'Conhecimento', 'Knowledge'],
      ['cura', 'sab', 'Cura', 'Healing'], ['diplomacia', 'car', 'Diplomacia', 'Diplomacy'], ['enganacao', 'car', 'Enganação', 'Deception'],
      ['fortitude', 'con', 'Fortitude', 'Fortitude'], ['furtividade', 'des', 'Furtividade', 'Stealth'], ['guerra', 'int', 'Guerra', 'War'],
      ['iniciativa', 'des', 'Iniciativa', 'Initiative'], ['intimidacao', 'car', 'Intimidação', 'Intimidation'], ['intuicao', 'sab', 'Intuição', 'Insight'],
      ['investigacao', 'int', 'Investigação', 'Investigation'], ['jogatina', 'car', 'Jogatina', 'Gambling'], ['ladinagem', 'des', 'Ladinagem', 'Thievery'],
      ['luta', 'for', 'Luta', 'Fighting'], ['misticismo', 'int', 'Misticismo', 'Mysticism'], ['nobreza', 'int', 'Nobreza', 'Nobility'],
      ['oficio', 'int', 'Ofício', 'Craft'], ['percepcao', 'sab', 'Percepção', 'Perception'], ['pilotagem', 'des', 'Pilotagem', 'Piloting'],
      ['pontaria', 'des', 'Pontaria', 'Aim'], ['reflexos', 'des', 'Reflexos', 'Reflexes'], ['religiao', 'sab', 'Religião', 'Religion'],
      ['sobrevivencia', 'sab', 'Sobrevivência', 'Survival'], ['vontade', 'sab', 'Vontade', 'Will'],
    ],
    stats: { hp: name('PV', 'HP'), ea: name('PM', 'MP') },
    trained: [[0, name('—', '—')], [1, name('Treinado', 'Trained')]],
    level: name('NÍVEL', 'LEVEL'),
    classLabel: name('CLASSE', 'CLASS'),
    defense: name('DEFESA', 'DEFENSE'),
  },
};

export const SYSTEM_IDS = ['abismo', 'ordem', 'dnd', 'tormenta', 'custom'];
const CUSTOM_STAT_DEFAULTS = { hp: name('Vida', 'Health'), ea: name('Mana', 'Mana'), san: name('Sanidade', 'Sanity'), vig: name('Vigor', 'Vigor') };

const pick = (value) => (value ? value[getLanguage() === 'en' ? 'en' : 'pt'] : '');

// Nome do sistema (para o seletor e o cabeçalho da ficha).
export function systemName(system, template = null) {
  return system === 'custom' ? (template?.name || t('system.custom')) : t(`system.${system}`);
}

// Atributos, perícias e barras do sistema da ficha, já com os nomes no idioma atual.
// abismo: devolve null (a ficha do Abismo usa as listas e textos próprios).
export function systemShape(sheet) {
  if (!sheet || !sheet.system || sheet.system === 'abismo') {
    return null;
  }
  if (sheet.system === 'custom') {
    const template = sheet.template || { attributes: [], skills: [], stats: ['hp'], statNames: {} };
    return {
      attributes: template.attributes.map((attribute) => [attribute.id, attribute.name]),
      skills: template.skills.map((skill) => [skill.id, skill.attribute, skill.name]),
      stats: template.stats.map((stat) => [stat, template.statNames?.[stat] || pick(CUSTOM_STAT_DEFAULTS[stat])]),
      trained: null,
      attributeDefault: 0,
      level: t('sheet.level'),
      classLabel: null,
      defense: null,
      resist: true,
    };
  }
  const def = BUILT_IN_SYSTEMS[sheet.system];
  return {
    attributes: Object.entries(def.attributes).map(([id, label]) => [id, pick(label)]),
    skills: def.skills.map(([id, attribute, pt, en]) => [id, attribute, getLanguage() === 'en' ? en : pt]),
    stats: Object.entries(def.stats).map(([id, label]) => [id, pick(label)]),
    trained: def.trained.map(([value, label]) => [value, pick(label)]),
    attributeDefault: def.attributeDefault,
    level: pick(def.level),
    classLabel: pick(def.classLabel),
    defense: pick(def.defense),
    resist: false,
  };
}

// Teste da perícia pela conta do sistema (igual ao servidor).
export function systemSkillTest(sheet, skillId, abismoAttributeOf) {
  const shape = systemShape(sheet);
  const skill = sheet.skills?.[skillId] || {};
  const trained = Number(skill.trained) || 0;
  const other = Number(skill.other) || 0;
  const level = Number(sheet.level) || 0;
  if (!shape) {
    const attribute = abismoAttributeOf(skillId);
    return trained + other + Math.floor((sheet.attributes?.[attribute]?.value || 0) / 2);
  }
  const attribute = shape.skills.find(([id]) => id === skillId)?.[1];
  if (!attribute) {
    return 0;
  }
  const score = Number(sheet.attributes?.[attribute]?.value) || 0;
  switch (sheet.system) {
    case 'ordem':
      return trained + other;
    case 'dnd':
      return Math.floor((score - 10) / 2) + trained * (2 + Math.floor(Math.max(0, level - 1) / 4)) + other;
    case 'tormenta':
      return Math.floor(level / 2) + score + (trained > 0 ? (level >= 15 ? 6 : level >= 7 ? 4 : 2) : 0) + other;
    default:
      return trained + other + score;
  }
}

// Notação do teste: em Ordem Paranormal rola-se o atributo em d20 (fica o maior).
export function systemTestNotation(sheet, skillId, bonus) {
  const signed = bonus ? (bonus > 0 ? `+${bonus}` : String(bonus)) : '';
  if (sheet?.system === 'ordem') {
    const attribute = systemShape(sheet)?.skills.find(([id]) => id === skillId)?.[1];
    const dice = Math.max(1, Number(sheet.attributes?.[attribute]?.value) || 0);
    return dice > 1 ? `${dice}d20kh1${signed}` : `1d20${signed}`;
  }
  return `1d20${signed}`;
}

// Ficha nova do sistema escolhido (atributos e perícias zerados).
export function shapeDefaults(system, template) {
  const shape = systemShape({ system, template });
  if (!shape) {
    return null;
  }
  return {
    attributes: Object.fromEntries(shape.attributes.map(([id]) => [id, { value: shape.attributeDefault, bonus: 0 }])),
    skills: Object.fromEntries(shape.skills.map(([id]) => [id, { trained: 0, other: 0 }])),
  };
}
