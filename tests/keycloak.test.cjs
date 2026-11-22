const {test} = require('node:test');
const assert = require('node:assert/strict');
const {keycloakAutoLogin} = require('../keycloak.js');

test('автовход запрещён за пределами DEV Keycloak',async()=>{
  global.location={origin:'https://example.test'};
  await assert.rejects(()=>keycloakAutoLogin({username:'user',password:'secret'}),/Недопустимый адрес/);
});

test('заполняет фактические поля loginInput и passwordInput',async()=>{
  class Input {
    constructor(){this._value='';this.events=[];}
    get value(){return this._value;}set value(value){this._value=String(value);}
    getClientRects(){return [{}];}dispatchEvent(event){this.events.push(event.type);}
  }
  const login=new Input(),password=new Input();let submitted=false;
  global.location={origin:'https://keycloak.dev.m99.dzm'};
  global.HTMLInputElement=Input;global.getComputedStyle=()=>({visibility:'visible'});
  global.document={querySelector(selector){
    if(selector.includes('#loginInput'))return login;if(selector.includes('#passwordInput'))return password;
    if(selector.includes('#next'))return{click(){submitted=true;}};return null;
  },querySelectorAll(){return[];}};
  const result=await keycloakAutoLogin({username:'tester',password:'secret'});
  assert.equal(result.state,'login-submitted');assert.equal(login.value,'tester');assert.equal(password.value,'secret');assert.ok(submitted);
});

test('выбирает заданный профиль и нажимает Войти',async()=>{
  class Select {
    constructor(){this._value='';this.options=[
      {value:'1',textContent:'Другой профиль'},
      {value:'139',textContent:'С8 ПО - Старшая медицинская сестра'}
    ];}
    get value(){return this._value;}set value(value){this._value=String(value);}
    getClientRects(){return[{}];}dispatchEvent(){}closest(){return null;}
  }
  const profile=new Select();let submitted=false;
  const button={type:'submit',textContent:'Войти',value:'',getClientRects(){return[{}];},click(){submitted=true;}};
  global.location={origin:'https://keycloak.dev.m99.dzm'};global.HTMLSelectElement=Select;global.getComputedStyle=()=>({visibility:'visible'});
  global.document={querySelector(selector){if(selector.includes('#profileInput'))return profile;return null;},querySelectorAll(){return[button];}};
  const result=await keycloakAutoLogin({profile:'С8 ПО - Старшая медицинская сестра'});
  assert.equal(result.state,'profile-selected');assert.equal(profile.value,'139');assert.ok(submitted);
});
