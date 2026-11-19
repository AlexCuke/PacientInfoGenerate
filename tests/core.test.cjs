const {test} = require('node:test');
const assert = require('node:assert/strict');
const {generate,snilsCheck,omsCheck,display,text} = require('../core.js');
test('СНИЛС: известный пример и граничные суммы', () => {
  assert.equal(snilsCheck('112233445'),'95');
  assert.equal(snilsCheck('000000000'),'00');
  assert.equal(snilsCheck('900000059'),'00'); // сумма 100
  assert.equal(snilsCheck('900000068'),'00'); // сумма 101
  assert.equal(snilsCheck('000000019'),'11');
  assert.equal(snilsCheck('000000899'),'51');
  assert.throws(() => snilsCheck('123'));
});
test('ОМС: ручной пример по алгоритму ТФОМС', () => {
  // Нечётные справа: 53197531 * 2 = 106395062; чётные: 4208642.
  // Сумма цифр: 32 + 26 = 58; контрольная цифра = 2.
  assert.equal(omsCheck('123456789012345'),'2');
  assert.equal(omsCheck('000000000000000'),'0');
  assert.throws(() => omsCheck('123'));
});
test('2000 карточек: форматы, контрольные цифры, возраст, даты и пол', () => {
  const now='2026-11-18';const seen=new Set();
  for(let i=0;i<2000;i++) {
    const sex=i%2?'female':'male';const age=[14,18,20,44,45,80,100][i%7];
    const p=generate({sex,age,today:now});
    assert.equal(p.sex,sex);assert.equal(p.metadata.registryVerified,false);
    assert.match(p.snils,/^\d{11}$/);assert.match(p.oms,/^[1-9]\d{15}$/);
    assert.equal(p.oms.at(-1), omsCheck(p.oms.slice(0, -1)));
    assert.match(p.phone,/^\+79\d{9}$/);
    assert.match(p.series,/^45\d{2}$/);assert.match(p.number,/^\d{6}$/);
    assert.ok(!/(\d)\1\1/.test(p.snils.slice(0,9)));
    const sum=[...p.snils.slice(0,9)].reduce((s,d,j)=>s+Number(d)*(9-j),0);
    const remainder=sum%101;
    assert.equal(Number(p.snils.slice(-2)),remainder===100?0:remainder);
    const birth=new Date(p.birthDate+'T00:00:00Z');const issue=new Date(p.issueDate+'T00:00:00Z');const today=new Date(now+'T00:00:00Z');
    const actual=today.getUTCFullYear()-birth.getUTCFullYear()-(now.slice(5)<p.birthDate.slice(5)?1:0);
    assert.equal(actual,age);assert.ok(issue<=today);assert.ok(issue>birth);
    const issueAge=issue.getUTCFullYear()-birth.getUTCFullYear()-(p.issueDate.slice(5)<p.birthDate.slice(5)?1:0);
    assert.equal(issueAge,age>=45?45:age>=20?20:14);
    assert.ok(p.middleName.endsWith(sex==='male'?'ич':'на'));
    seen.add(p.snils);
  }
  assert.ok(seen.size>1990);
});
test('elastic_new: форматы реквизитов, контрольные суммы и копирование', () => {
  for (let i = 0; i < 100; i++) {
    const patient = generate({mode: 'elastic', sex: 'female', age: 20});
    assert.equal(patient.sex, 'male');
    assert.equal(patient.birthDate, '1988-03-12');
    assert.match(patient.middleName, /ич$/);
    assert.match(patient.series, /^[1-9]\d{3}$/);
    assert.match(patient.number, /^[1-9]\d{5}$/);
    assert.match(patient.phone, /^\+79\d{9}$/);
    assert.match(patient.snils, /^[1-9]\d{10}$/);
    assert.equal(patient.snils.slice(-2), snilsCheck(patient.snils.slice(0, 9)));
    assert.match(patient.oms, /^[1-9]\d{15}$/);
    const luhnSum = [...patient.oms].reduce((sum, digit, index) => {
      const value = Number(digit);
      return sum + (index % 2 === 0 ? (value * 2 > 9 ? value * 2 - 9 : value * 2) : value);
    }, 0);
    assert.equal(luhnSum % 10, 0);
    assert.ok(text(patient).includes('Дата рождения: 12.03.1988'));
    assert.ok(text(patient).includes('Телефон: ' + patient.phone));
    assert.doesNotMatch(text(patient), /Кем выдан|Когда выдан|undefined/);
  }
});
test('карточка предыдущей версии копируется без поля телефона', () => {
  const patient = generate();
  delete patient.phone;
  assert.doesNotMatch(text(patient), /Телефон|undefined/);
});
test('проверка возраста и форматирование',()=>{
  for(const age of [13,101,14.5,NaN]) assert.throws(()=>generate({age}));
  assert.equal(display('snils','11223344595'),'112-233-445 95');
  assert.equal(display('birthDate','2000-02-29'),'29.02.2000');
});
