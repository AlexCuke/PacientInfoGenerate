const {test} = require('node:test');
const assert = require('node:assert/strict');
const {fillPatientForm} = require('../autofill.js');
const {generate} = require('../core.js');
// Минимальная модель DOM: проверяет выбор полей, защиту значений и отчёт.
// Проверка настоящих виджетов приложения требует браузера и доступа к форме.
class Input {
  constructor(label,type='text') {this.tagName='INPUT';this.type=type;this.labels=[{textContent:label}];this.attrs={};this._value='';this.checked=false;this.isConnected=true;this.maxLength=-1;this.events=[];}
  get value(){return this._value;}set value(v){this._value=String(v);}
  getAttribute(k){return this.attrs[k]||null;}getClientRects(){return [{}];}closest(){return null;}
  dispatchEvent(e){this.events.push(e.type);}click(){this.checked=!this.checked;}
}
class Select extends Input {
  constructor(label,options){super(label);this.tagName='SELECT';this.options=options.map(([textContent,value])=>({textContent,value}));}
  get value(){return this._value;}set value(v){this._value=String(v);}
}
function install(controls) {
  global.location={origin:'https://reg.dev.m99.dzm',pathname:'/samotek'};
  global.HTMLInputElement=Input;global.HTMLSelectElement=Select;global.HTMLTextAreaElement=Input;
  global.FocusEvent=Event;global.getComputedStyle=()=>({visibility:'visible'});
  global.document={getElementById:()=>null,querySelectorAll(selector){
    if(selector==='[role=dialog],dialog[open]')return [];
    if(selector==='input,select,textarea')return controls;
    if(selector==='#custom')return controls.filter(x=>x.id==='custom');
    if(selector==='[')throw new Error('invalid selector');
    return [];
  }};
}
test('12 полей со скриншота: подписи, даты, пол, выбор паспорта', async()=>{
  const controls=[new Select('Документ, удостоверяющий личность',[['Выберите',''],['Паспорт гражданина РФ','21']]),
    ...['Серия','Номер','Кем выдан','Когда выдан','Фамилия','Имя','Отчество','Дата рождения','СНИЛС','Полис ОМС'].map(x=>new Input(x)),
    new Input('Муж','checkbox'),new Input('Жен','checkbox')];
  install(controls);const p=generate({sex:'female'});const result=await fillPatientForm(p);
  assert.equal(result.filled.length,12);assert.deepEqual(result.errors,[]);assert.deepEqual(result.skipped,[]);
  assert.equal(controls[0].value,'21');assert.equal(controls[11].checked,false);assert.equal(controls[12].checked,true);
  assert.equal(controls[5].value,p.lastName);assert.match(controls[4].value,/^\d{2}\.\d{2}\.\d{4}$/);
  assert.ok(controls[5].events.includes('input'));assert.ok(controls[5].events.includes('change'));
});
test('не изменяет заполненные, неоднозначные, скрытые и readonly поля',async()=>{
  const first=new Input('Фамилия');first.value='Существующая';const read=new Input('СНИЛС');read.readOnly=true;
  const hidden=new Input('Полис ОМС');hidden.getClientRects=()=>[];
  const controls=[first,new Input('Имя'),new Input('Имя'),read,hidden];install(controls);
  const result=await fillPatientForm(generate());
  assert.equal(first.value,'Существующая');assert.equal(read.value,'');assert.equal(hidden.value,'');
  assert.equal(result.filled.length,0);assert.ok(result.skipped.some(x=>x.includes('несколько полей')));
});
test('замена по явному флагу и CSS-соответствие',async()=>{
  const input=new Input('Необычная подпись');input.id='custom';input.value='Старое';install([input]);
  const p=generate();const result=await fillPatientForm(p,{lastName:'#custom',oms:'['},true);
  assert.equal(input.value,p.lastName);assert.ok(result.errors.some(x=>x.includes('CSS')));
});
test('пол с существующим выбором сохраняется, по флагу заменяется',async()=>{
  const male=new Input('Муж','checkbox'),female=new Input('Жен','checkbox');male.checked=true;install([male,female]);
  const p=generate({sex:'female'});await fillPatientForm(p);assert.ok(male.checked);assert.ok(!female.checked);
  await fillPatientForm(p,{},true);assert.ok(!male.checked);assert.ok(female.checked);
});
test('ограничивает адрес и путь DEV',async()=>{
  install([]);global.location.pathname='/samotek-other';await assert.rejects(()=>fillPatientForm(generate()));
  global.location.pathname='/samotek';global.location.origin='https://reg.prod.m99.dzm';await assert.rejects(()=>fillPatientForm(generate()));
});
