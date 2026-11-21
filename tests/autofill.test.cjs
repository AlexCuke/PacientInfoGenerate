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
test('находит Angular-поля по подписи внутри lu-input-wrapper',async()=>{
  const labels=['Серия','Номер','Кем выдан','Фамилия','Имя','Отчество','СНИЛС','Полис ОМС','Муж','Жен'];
  const controls=labels.map((label,index)=>{
    const input=new Input('',index>7?'checkbox':'text');
    input.parentElement={textContent:label};
    input.closest=selector=>selector.includes('lu-input-wrapper')?input.parentElement:null;
    return input;
  });
  install(controls);const p=generate({sex:'male'});const result=await fillPatientForm(p);
  assert.deepEqual(result.errors,[]);
  assert.equal(controls[0].value,p.series);assert.equal(controls[1].value,p.number);
  assert.equal(controls[2].value,p.issuer);assert.equal(controls[3].value,p.lastName);
  assert.equal(controls[4].value,p.firstName);assert.equal(controls[5].value,p.middleName);
  assert.equal(controls[6].value.replace(/\D/g,''),p.snils);assert.equal(controls[7].value,p.oms);
  assert.equal(controls[8].checked,true);assert.equal(controls[9].checked,false);
});
test('находит и форматирует безымянные поля по маскам luMask',async()=>{
  const specs=[['99 99','tel'],['999999','tel'],['999-999-999 99','tel'],['9999 9999 9999 9999','tel']];
  const controls=specs.map(([mask,type])=>{const input=new Input('',type);input.attrs.lumask=mask;return input;});
  install(controls);const p=generate();const result=await fillPatientForm(p);
  assert.deepEqual(result.errors,[]);
  assert.equal(controls[0].value,p.series.replace(/(\d{2})(\d{2})/,'$1 $2'));
  assert.equal(controls[1].value,p.number);
  assert.equal(controls[2].value,p.snils.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1-$2-$3 $4'));
  assert.equal(controls[3].value,p.oms.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/,'$1 $2 $3 $4'));
});
test('вводит значения luMask через Chromium insertText',async()=>{
  const input=new Input('','tel');input.attrs.lumask='999-999-999 99';
  let focused;input.focus=()=>{focused=input;};input.select=()=>{};install([input]);
  document.execCommand=(command,showUi,text)=>{assert.equal(command,'insertText');focused.value=text;return true;};
  const p=generate();const result=await fillPatientForm(p);
  assert.deepEqual(result.errors,[]);assert.equal(input.value,p.snils);
});
test('не принимает видимую маску за заполненное значение',async()=>{
  const input=new Input('','tel');input.attrs.lumask='999-999-999 99';input.value='999-999-999 99';
  input.classList={contains:name=>name==='hide-mask'};
  install([input]);const p=generate();const result=await fillPatientForm(p);
  assert.ok(result.filled.includes('snils'));assert.equal(input.value.replace(/\D/g,''),p.snils);
});
test('различает две radio с общим именем gender по подписям',async()=>{
  const male=new Input('Муж','radio'),female=new Input('Жен','radio');
  male.name='gender';female.name='gender';install([male,female]);
  const result=await fillPatientForm(generate({sex:'female'}));
  assert.ok(result.filled.includes('sex'));assert.equal(male.checked,false);assert.equal(female.checked,true);
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
