const {test} = require('node:test');
const assert = require('node:assert/strict');
const {normalizeText, submitPatientRegistration, inspectSubmission} = require('../workflow.js');

function button(text, {disabled=false}={}) {
  return {textContent:text,disabled,dataset:{},clicks:0,getClientRects(){return[{}];},
    getAttribute(name){return name==='data-lu-disabled'&&disabled?'true':'false';},click(){this.clicks++;}};
}

function install(buttons, notices=[]) {
  global.location={origin:'https://reg.dev.m99.dzm',pathname:'/samotek'};
  global.getComputedStyle=()=>({visibility:'visible'});
  global.document={querySelectorAll(selector){
    if(selector==='button')return buttons;
    if(selector.includes('[role=alert]'))return notices;
    return[];
  }};
}

test('нормализует подписи финальных кнопок',()=>{
  assert.equal(normalizeText(' Зарегистрировать и распечатать браслет '),'зарегистрироватьираспечататьбраслет');
  assert.equal(normalizeText('Перейти к Триажу'),'перейтикТриажу'.toLowerCase());
});

test('нажимает регистрацию только один раз',()=>{
  const action=button(' Зарегистрировать и распечатать браслет ');install([action]);
  assert.equal(submitPatientRegistration().state,'submitted');
  assert.equal(submitPatientRegistration().state,'submitted');
  assert.equal(action.clicks,1);
});

test('не нажимает недоступную регистрацию',()=>{
  const action=button('Зарегистрировать и распечатать браслет',{disabled:true});install([action]);
  assert.equal(submitPatientRegistration().state,'waiting');assert.equal(action.clicks,0);
});

test('после регистрации нажимает штатную кнопку перехода к триажу один раз',()=>{
  const action=button(' Перейти к Триажу ');install([action]);
  assert.equal(inspectSubmission('registration').state,'transitioned');
  assert.equal(inspectSubmission('registration').state,'transitioned');
  assert.equal(action.clicks,1);
});
