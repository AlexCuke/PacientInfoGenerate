(function (root) {
  'use strict';
  const environments = {
    'M99 DEV': 'http://registration.dev.m99.dzm',
    'M99 ТПАК': 'http://registration.test.m99.dzm',
    M15: 'http://registration-tpak.m15.dzm'
  };
  const caseFields = {
    authorDept: ['Подразделение автора', 'С8 Приемное отделение'],
    authorId: ['СНИЛС автора', '470-581-305 79'],
    authorIdAssigner: ['ID организации автора', 'bf5e6f57-30d2-410a-851c-50765f320841'],
    authorPost: ['Должность автора', 'Медицинский регистратор'],
    cause: ['Причина обращения', 'внезапное заболевание'],
    ctxComposerName: ['ФИО автора', 'Тимофеева Е.А.'],
    dept_id: ['ID отделения', 'd7813ddb-c290-437c-ab42-608d3ba8903e'],
    severityCode: ['Код тяжести состояния', 'at0002'],
    severityValue: ['Тяжесть состояния', 'удовлетворительное']
  };
  const preparation = {
    registries: ['/erzl', '/erp'],
    synchronize: ['/synchronize']
  };

  function patientPayload(patient) {
    const {lastName, firstName, middleName, birthDate, sex, snils, oms, series, number} = patient ?? {};
    if (!lastName || !firstName || !birthDate || !['male', 'female'].includes(sex)) {
      throw new Error('Сначала сгенерируйте карточку пациента.');
    }
    const payload = {
      surname: lastName, name: firstName, patron: middleName, birth: birthDate,
      snils: snils?.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1-$2-$3 $4'),
      idoc_num: oms, dudl_ser: series, dudl_num: number, sex: sex === 'male' ? 1 : 2
    };
    return Object.fromEntries(Object.entries(payload).filter(([, value]) => value));
  }

  async function request(baseUrl, method, path, payload) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8'},
      body: JSON.stringify(payload),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(30000)
    });
    const body = (await response.text()).trim();
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + (body ? ' · ' + body.slice(0, 2000) : ''));
    }
    if (!body) return {http_status: response.status};
    try {
      return JSON.parse(body);
    } catch {
      throw new Error('Сервис вернул некорректный JSON (HTTP ' + response.status + ').');
    }
  }

  function responseState(response) {
    return Array.isArray(response)
      ? response.find(row => row && typeof row === 'object' && !Array.isArray(row))
      : response;
  }

  async function register({environment, patient, processId = '', workflow, details, onStep = () => {}}) {
    if (!Object.hasOwn(environments, environment)) throw new Error('Выберите контур регистрации.');
    const baseUrl = environments[environment];
    const casePayload = {};
    for (const [key, [label]] of Object.entries(caseFields)) {
      const value = details[key]?.trim();
      if (!value) throw new Error('Заполните поле «' + label + '».');
      casePayload[key] = value;
    }

    let id = processId.trim();
    async function run(method, path, payload) {
      const operation = method + ' ' + path.split('?')[0];
      onStep({operation, id});
      let result;
      try {
        result = await request(baseUrl, method, path, payload);
      } catch (error) {
        throw new Error(operation + ' · ' + error.message, {cause: error});
      }
      const state = responseState(result);
      if (path !== '/register') {
        const nextId = state?.id || state?.process_id || state?.processId;
        if (nextId) id = String(nextId);
      }
      onStep({operation, id, result});
      return result;
    }

    if (!id) {
      if (!Object.hasOwn(preparation, workflow)) throw new Error('Выберите этапы подготовки.');
      let payload = patientPayload(patient);
      const stages = [
        ['POST', '/prepare?unknown=False'],
        ...preparation[workflow].map(path => ['POST', path]),
        ['PUT', '/draft?peoplesays=False']
      ];
      for (const [method, path] of stages) {
        payload = responseState(await run(method, path, payload));
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new Error(path.split('?')[0] + ' · ожидается объект состояния процесса.');
        }
        if (!id) throw new Error(path.split('?')[0] + ' · сервис не вернул Process ID.');
      }
    }
    const date = new Date().toISOString();
    return {id, result: await run('POST', '/register', {...casePayload, id, date, dateDirected: date})};
  }

  const api = {environments, caseFields, register};
  if (typeof module !== 'undefined') module.exports = api;
  root.PatientRegistration = api;
})(globalThis);
