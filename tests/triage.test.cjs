const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createTriageValues} = require('../triage.js');

test('генерирует допустимые показатели триажа',()=>{
  const values=createTriageValues({sex:'male'},()=>0.5);
  assert.ok(+values.spo2>=95&&+values.spo2<=100);
  assert.ok(+values.chdd>=12&&+values.chdd<=20);
  assert.ok(+values.chss>=60&&+values.chss<=100);
  assert.ok(+values.pressureSys>+values.pressureDia);
  assert.match(values.temp,/^\d{2}\.\d$/);
  assert.ok(values.pain>=1&&values.pain<=10);
  assert.equal(values.pregnancy,'нет');
});

test('случайные границы не выходят из диапазонов',()=>{
  for(const random of [()=>0,()=>0.999999]){
    const values=createTriageValues({sex:'female'},random);
    assert.ok(+values.spo2>=95&&+values.spo2<=100);
    assert.ok(+values.pressureDia<+values.pressureSys);
    assert.ok(+values.temp>=36.1&&+values.temp<=37.4);
  }
});
