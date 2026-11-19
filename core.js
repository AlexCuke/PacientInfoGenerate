(function (root) {
  'use strict';
  const fields = {
    documentType: 'Документ, удостоверяющий личность', series: 'Серия', number: 'Номер',
    issuer: 'Кем выдан', issueDate: 'Когда выдан', sex: 'Пол', lastName: 'Фамилия',
    firstName: 'Имя', middleName: 'Отчество', birthDate: 'Дата рождения', snils: 'СНИЛС', oms: 'Полис ОМС'
  };
  const male = ['Александр','Дмитрий','Максим','Андрей','Алексей','Сергей','Иван','Михаил','Денис','Павел'];
  const female = ['Анна','Мария','Елена','Ольга','Наталья','Ирина','Татьяна','Светлана','Екатерина','Дарья'];
  const surnames = ['Иванов','Петров','Смирнов','Волков','Соколов','Попов','Морозов','Орлов','Захаров','Новиков'];
  const fathers = [ ['Александрович','Александровна'], ['Дмитриевич','Дмитриевна'], ['Андреевич','Андреевна'], ['Сергеевич','Сергеевна'], ['Михайлович','Михайловна'], ['Иванович','Ивановна'] ];
  const pad = (n, length = 2) => String(n).padStart(length, '0');
  function integer(min, max) {
    const range = max - min + 1;
    const limit = Math.floor(4294967296 / range) * range;
    const value = new Uint32Array(1);
    do { globalThis.crypto.getRandomValues(value); } while (value[0] >= limit);
    return min + value[0] % range;
  }
  const pick = values => values[integer(0, values.length - 1)];
  function snilsCheck(base) {
    if (!/^\d{9}$/.test(base)) throw new Error('Основа СНИЛС должна содержать 9 цифр');
    const remainder = [...base].reduce((sum, digit, i) => sum + Number(digit) * (9 - i), 0) % 101;
    return pad(remainder === 100 ? 0 : remainder);
  }
  function omsCheck(base) {
    if (!/^\d{15}$/.test(base)) throw new Error('Основа ЕНП должна содержать 15 цифр');
    // ТФОМС: цифры нечётных позиций СПРАВА записываются в число и умножаются на 2.
    // Это умножение целого числа, а не независимое удвоение каждой цифры.
    const reversed = [...base].reverse();
    const odd = reversed.filter((_, i) => i % 2 === 0).join('');
    const even = reversed.filter((_, i) => i % 2 === 1).join('');
    const sum = [...even + String(Number(odd) * 2)].reduce((s, d) => s + Number(d), 0);
    return String((10 - sum % 10) % 10);
  }
  const iso = date => date.toISOString().slice(0, 10);
  const dateAt = (year, month, day) => new Date(Date.UTC(year, month, day));
  function anniversary(date, years) {
    const result = dateAt(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate());
    if (result.getUTCMonth() !== date.getUTCMonth()) result.setUTCDate(0);
    return result;
  }
  function generate(options = {}) {
    const todayISO = options.today || new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Moscow'}).format(new Date());
    const today = new Date(todayISO + 'T00:00:00Z');
    if (!Number.isFinite(today.getTime())) throw new Error('Некорректная текущая дата');
    const sex = options.sex === 'male' || options.sex === 'female' ? options.sex : pick(['male','female']);
    const age = options.age == null ? integer(18, 80) : Number(options.age);
    if (!Number.isInteger(age) || age < 14 || age > 100) throw new Error('Возраст: целое число от 14 до 100');
    // Подбираем день рождения так, чтобы на today полных лет было ровно age.
    let birth;
    do {
      birth = dateAt(today.getUTCFullYear() - age - integer(0, 1), integer(0, 11), integer(1, 28));
    } while ((today.getUTCFullYear() - birth.getUTCFullYear() - (anniversary(birth, today.getUTCFullYear() - birth.getUTCFullYear()) > today ? 1 : 0)) !== age);
    const passportAge = age >= 45 ? 45 : age >= 20 ? 20 : 14;
    const earliest = anniversary(birth, passportAge);
    const issue = new Date(earliest.getTime() + integer(0, Math.min(30, Math.floor((today - earliest) / 86400000))) * 86400000);
    const issueYear = issue.getUTCFullYear();
    let base;
    do { base = String(integer(1001999, 999999999)).padStart(9,'0'); } while (/(\d)\1\1/.test(base));
    const snils = base + snilsCheck(base);
    const omsBase = String(integer(1, 9)) + Array.from({length:14}, () => integer(0, 9)).join('');
    const isFemale = sex === 'female';
    return {
      documentType:'Паспорт гражданина Российской Федерации',
      series:'45' + String(issue.getUTCFullYear()).slice(-2), number:pad(integer(1,999999),6),
      issuer:issueYear >= 2017 ? 'ГУ МВД России по г. Москве' : issueYear >= 2005 ? 'УФМС России по г. Москве' : 'ОВД района Тверской г. Москвы',
      issueDate:iso(issue), sex, lastName:pick(surnames) + (isFemale ? 'а' : ''),
      firstName:pick(isFemale ? female : male), middleName:pick(fathers)[isFemale ? 1 : 0],
      birthDate:iso(birth), snils, oms:omsBase + omsCheck(omsBase),
      metadata:{synthetic:true, registryVerified:false, age, generatedOn:todayISO}
    };
  }
  function display(key, value) {
    if (key === 'sex') return value === 'male' ? 'Мужской' : 'Женский';
    if (key === 'issueDate' || key === 'birthDate') return value.split('-').reverse().join('.');
    if (key === 'snils') return value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1-$2-$3 $4');
    return value;
  }
  function text(patient) { return Object.keys(fields).map(k => fields[k] + ': ' + display(k, patient[k])).join('\n'); }
  const api = {fields, generate, snilsCheck, omsCheck, display, text};
  if (typeof module !== 'undefined') module.exports = api;
  root.PatientGenerator = api;
})(globalThis);
