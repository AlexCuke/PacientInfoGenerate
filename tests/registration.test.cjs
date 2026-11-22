const {test} = require('node:test');
const assert = require('node:assert/strict');
const {generate} = require('../core.js');
const {caseFields, environments, register} = require('../registration.js');
const manifest = require('../manifest.json');

const environment = 'M99 DEV';
const details = Object.fromEntries(Object.entries(caseFields).map(([key, [, value]]) => [key, value]));

test('адреса контуров согласованы с разрешениями расширения', () => {
  const registrationPermissions = manifest.host_permissions.filter(url => url.startsWith('http://registration'));
  assert.deepEqual(Object.values(environments).map(url => url + '/*').sort(), registrationPermissions.sort());
  assert.ok(manifest.host_permissions.includes('https://reg.dev.m99.dzm/*'));
  assert.ok(manifest.host_permissions.includes('https://keycloak.dev.m99.dzm/*'));
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.permissions.includes('tabs'));
});

test('регистрация передаёт состояние процесса между этапами', async t => {
  const calls = [];
  const steps = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url.slice(environments[environment].length), options.method, JSON.parse(options.body)]);
    return calls.length === 5
      ? Response.json([{caseId: 'case-1'}])
      : Response.json([{processId: 'process-1', step: calls.length}]);
  });
  const patient = generate({mode: 'elastic'});
  const result = await register({environment, details, patient, workflow: 'registries', onStep: step => steps.push(step)});

  assert.deepEqual(calls.map(([path, method]) => [path, method]), [
    ['/prepare?unknown=False', 'POST'], ['/erzl', 'POST'], ['/erp', 'POST'],
    ['/draft?peoplesays=False', 'PUT'], ['/register', 'POST']
  ]);
  assert.deepEqual(calls[0][2], {
    surname: patient.lastName, name: patient.firstName, patron: patient.middleName,
    birth: '1988-03-12', snils: patient.snils.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1-$2-$3 $4'),
    idoc_num: patient.oms, dudl_ser: patient.series, dudl_num: patient.number, sex: 1
  });
  for (let i = 1; i < 4; i++) assert.deepEqual(calls[i][2], {processId: 'process-1', step: i});
  const {date, ...casePayload} = calls[4][2];
  assert.equal(new Date(date).toISOString(), date);
  assert.deepEqual(casePayload, {...details, id: 'process-1', dateDirected: date});
  assert.deepEqual(result, {id: 'process-1', result: [{caseId: 'case-1'}]});
  assert.equal(steps.at(-1).id, 'process-1');
});

test('готовый черновик отправляется напрямую в /register', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, environments[environment] + '/register');
    assert.equal(JSON.parse(options.body).id, 'draft-1');
    return new Response(null, {status: 204});
  });
  const result = await register({environment, details, processId: ' draft-1 '});
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(result, {id: 'draft-1', result: {http_status: 204}});
});

test('ошибка синхронизации останавливает запросы и показывает ответ сервиса', async t => {
  const paths = [];
  t.mock.method(globalThis, 'fetch', async url => {
    paths.push(new URL(url).pathname);
    if (paths.length === 1) return Response.json({id: 'draft-2'});
    return Response.json({message: 'Черновик отклонён'}, {status: 422});
  });
  await assert.rejects(register({
    environment, details, patient: generate(), workflow: 'synchronize'
  }), /POST \/synchronize.*HTTP 422.*Черновик отклонён/);
  assert.deepEqual(paths, ['/prepare', '/synchronize']);
});
