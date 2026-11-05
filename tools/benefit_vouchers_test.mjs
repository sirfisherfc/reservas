import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVoucherSession, normalizeVoucherCode, voucherBenefit, voucherDate,
  voucherEventTime, voucherStatus, createRecentVoucherList, RECENT_VOUCHERS_PAGE_SIZE,
} from '../assets/js/benefit-vouchers.mjs';

const base = {
  id: '11111111-1111-4111-8111-111111111111', code: 'SF-0123-ABCD-WXYZ',
  beneficiary_name: 'Beneficiário de teste com nome bastante longo para conferência',
  benefit_type: 'fixed', benefit_value: 250.5, expires_on: '2026-12-04',
  status: 'available', revision: 1, unit_name: 'Sir Fisher', conditions: ['Uso único.'],
};
const found = (overrides = {}) => ({ data: { ok: true, voucher: { ...base, ...overrides } }, error: null });
const nextResult = (queue, calls) => async (name, args) => {
  calls.push({ name, args });
  const result = queue.shift();
  if (result instanceof Error) throw result;
  return result;
};

const recentItem = { code: 'A1B2C3', beneficiary_name: 'Cliente de teste', benefit_type: 'fixed', benefit_value: 100,
  used_at: '2026-11-05T14:00:00Z', used_by_name: 'Equipe de teste' };
const recentResponse = (items = [], total = items.length) => ({ data: { ok: true, items, total }, error: null });

test('lista recente pagina pela RPC própria e mantém somente os campos da conferência', async () => {
  const calls = [];
  const list = createRecentVoucherList(nextResult([recentResponse([{ ...recentItem, phone: 'privado', internal_note: 'privado', issue_reason: 'friend' }], 21)], calls));
  assert.equal((await list.load(20)).kind, 'loaded');
  assert.deepEqual(calls, [{ name: 'benefit_voucher_recent', args: { p_offset: 20, p_limit: RECENT_VOUCHERS_PAGE_SIZE } }]);
  assert.equal(list.state.total, 21); assert.equal(list.state.offset, 20);
  assert.deepEqual(list.state.items, [recentItem]); assert.equal(list.state.busy, false);
});

test('lista recente vazia é distinta de erro e não executa utilização', async () => {
  const calls = []; const list = createRecentVoucherList(nextResult([recentResponse()], calls));
  assert.equal((await list.load()).kind, 'loaded'); assert.equal(list.state.total, 0);
  assert.deepEqual(list.state.items, []); assert.equal(calls.length, 1);
});

test('falha, falta de permissão e limite limpam a lista sem conservar dados antigos', async () => {
  for (const [failure, kind] of [[new Error('offline'), 'failed'], [{ data: null, error: { code: '42501' } }, 'denied'], [{ data: { ok: false, reason: 'rate_limited' } }, 'rate_limited']]) {
    const list = createRecentVoucherList(nextResult([recentResponse([recentItem]), failure], []));
    await list.load(); assert.equal(list.state.items.length, 1);
    assert.equal((await list.load()).kind, kind); assert.deepEqual(list.state.items, []); assert.equal(list.state.busy, false);
  }
});

test('atualização após validação prevalece sobre consulta anterior ainda em andamento', async () => {
  const pending = []; const list = createRecentVoucherList(() => new Promise(resolve => pending.push(resolve)));
  const older = list.load(20), newer = list.load(0);
  pending[1](recentResponse([recentItem])); assert.equal((await newer).kind, 'loaded');
  pending[0](recentResponse([], 21)); assert.equal((await older).kind, 'superseded');
  assert.equal(list.state.offset, 0); assert.deepEqual(list.state.items, [recentItem]); assert.equal(list.state.busy, false);
});

test('respostas incompletas e páginas inválidas não viram histórico válido', async () => {
  for (const response of [recentResponse([null]), recentResponse([{ ...recentItem, used_at: null }]), recentResponse([{ ...recentItem, code: 'INVÁLIDO' }]), recentResponse([recentItem], -1)]) {
    const list = createRecentVoucherList(async () => response);
    assert.equal((await list.load()).kind, 'failed'); assert.deepEqual(list.state.items, []);
  }
  const list = createRecentVoucherList(() => assert.fail('não deve consultar página inválida'));
  assert.equal((await list.load(-1)).kind, 'invalid_page'); assert.equal((await list.load(1.5)).kind, 'invalid_page');
});

test('aceita código legível colado e rejeita dados incompletos/URL', () => {
  assert.equal(normalizeVoucherCode(' sf 0123 abcd wxyz '), base.code);
  assert.equal(normalizeVoucherCode('sf0123abcdwxyz'), base.code);
  assert.equal(normalizeVoucherCode('0123ABCDWXYZ'), base.code);
  assert.equal(normalizeVoucherCode('SF-0000-1111-2222'), 'SF-0000-1111-2222');
  assert.equal(normalizeVoucherCode('SF-OIL0-ABCD-WXYZ'), 'SF-0110-ABCD-WXYZ');
  for (const bad of ['', 'SF-ABC', 'SF-0123-ABCD-WXYZ-Z', 'SF-0123-ABCD-WXYU', `https://example.test/#${base.code}`]) {
    assert.equal(normalizeVoucherCode(bad), null);
  }
});

test('formata percentuais separadamente de reais, valores altos e centavos', () => {
  assert.match(voucherBenefit(base), /250,50/);
  assert.equal(voucherBenefit({ benefit_type: 'percent', benefit_value: 12.5 }), '12,5% de desconto');
  assert.equal(voucherBenefit({ benefit_type: 'percent', benefit_value: 100 }), '100% de desconto');
  assert.match(voucherBenefit({ benefit_type: 'fixed', benefit_value: 12345.67 }), /12\.345,67/);
  assert.equal(voucherBenefit({ benefit_type: 'fixed', benefit_value: 0 }), 'Benefício indisponível');
});
test('aceita seis caracteres sem prefixo e normaliza letras ambíguas',()=>{
  assert.equal(normalizeVoucherCode(' a1b2c3 '),'A1B2C3');
  assert.equal(normalizeVoucherCode('oIl-ab2'),'011AB2');
  assert.equal(normalizeVoucherCode('U12345'),null);
});
test('consulta seis caracteres e aceita o alias antigo do mesmo voucher',async()=>{
  const short='A1B2C3',legacy=base.code;
  const session=createVoucherSession(async()=>found({code:short,legacy_code:legacy}));
  assert.equal((await session.lookup(short)).kind,'found');assert.equal(session.state.voucher.code,short);
  assert.equal((await session.lookup(legacy)).kind,'found');assert.equal(session.state.voucher.code,short);
  const compatible=createVoucherSession(async()=>found({code:legacy,short_code:short,legacy_code:legacy}));
  assert.equal((await compatible.lookup(legacy)).kind,'found');assert.equal(compatible.state.voucher.code,short);
});

test('datas puras e eventos usam convenção inequívoca de Fortaleza', () => {
  assert.equal(voucherDate('2026-12-04'), '04/12/2026');
  assert.equal(voucherDate(null), 'Data indisponível');
  assert.equal(voucherEventTime('2026-11-05T02:59:00Z'), '04/11/2026, 23:59');
  assert.equal(voucherEventTime('2026-11-05T03:00:00Z'), '05/11/2026, 00:00');
  assert.equal(voucherEventTime('inválido'), 'Horário indisponível');
  assert.equal(voucherStatus('unknown').label, 'Situação indisponível');
});

test('código inválido não consulta servidor; consulta mantém apenas campos necessários', async () => {
  const calls = [];
  const session = createVoucherSession(nextResult([found({
    phone: 'privado', internal_notes: 'privado', issue_reason: 'privado', issue_reason_detail: 'privado',
  })], calls));
  assert.equal((await session.lookup('SF-ABC')).kind, 'invalid_code');
  assert.equal(calls.length, 0);
  assert.equal((await session.lookup('sf-oi23-abcd-wxyz')).kind, 'found');
  assert.equal(session.state.voucher.beneficiary_name, base.beneficiary_name);
  assert.equal(session.state.voucher.revision, 1);
  assert.equal(Object.hasOwn(session.state.voucher, 'phone'), false);
  assert.equal(Object.hasOwn(session.state.voucher, 'internal_notes'), false);
  assert.equal(Object.hasOwn(session.state.voucher, 'issue_reason'), false);
  assert.equal(Object.hasOwn(session.state.voucher, 'issue_reason_detail'), false);
  assert.deepEqual(calls[0], { name: 'benefit_voucher_lookup', args: { p_code: base.code } });
});

test('resgate exige confirmação explícita, usa UUID e não pode ser repetido', async () => {
  const calls = [];
  const session = createVoucherSession(nextResult([found(), found({ status: 'used', used_at: '2026-11-04T15:00:00Z', used_by_name: 'Gerente teste' })], calls));
  await session.lookup(base.code);
  assert.equal((await session.redeem()).kind, 'confirmation_required');
  assert.equal(calls.length, 1);
  assert.equal((await session.redeem(true)).kind, 'redeemed');
  assert.deepEqual(calls[1], { name: 'benefit_voucher_redeem', args: { p_id: base.id, p_confirm: true, p_expected_revision: 1 } });
  assert.equal(session.state.voucher.status, 'used');
  assert.equal((await session.redeem(true)).kind, 'refresh_required');
  assert.equal(calls.length, 2);
});

test('dois cliques concorrentes geram somente uma chamada de resgate', async () => {
  const calls = [];
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const session = createVoucherSession(async (name, args) => {
    calls.push({ name, args });
    return name === 'benefit_voucher_lookup' ? found() : pending;
  });
  await session.lookup(base.code);
  const first = session.redeem(true);
  assert.equal((await session.redeem(true)).kind, 'busy');
  assert.equal((await session.lookup(base.code)).kind, 'busy');
  finish(found({ status: 'used' }));
  assert.equal((await first).kind, 'redeemed');
  assert.equal(calls.filter(({ name }) => name === 'benefit_voucher_redeem').length, 1);
  assert.equal(session.state.busy, false);
});

test('edição após consulta recusa a confirmação antiga e exige conferir a nova revisão', async () => {
  const calls = [];
  const edited = { revision: 2, benefit_value: 100, beneficiary_name: 'Nome corrigido' };
  const session = createVoucherSession(nextResult([
    found(), { data: { ok: false, reason: 'changed', voucher: { ...base, ...edited } }, error: null },
    found(edited), found({ ...edited, status: 'used' }),
  ], calls));
  await session.lookup(base.code);
  assert.deepEqual(await session.redeem(true), { kind: 'refused', reason: 'changed' });
  assert.equal(session.state.voucher.revision, 2);
  assert.equal(session.state.voucher.benefit_value, 100);
  assert.equal(session.state.voucher.beneficiary_name, 'Nome corrigido');
  assert.equal(session.state.needsRefresh, false);
  assert.deepEqual(calls.map(({ name }) => name), ['benefit_voucher_lookup', 'benefit_voucher_redeem', 'benefit_voucher_lookup']);
  assert.equal(calls[1].args.p_expected_revision, 1);
  assert.equal((await session.redeem()).kind, 'confirmation_required');
  assert.equal(calls.length, 3);
  assert.equal((await session.redeem(true)).kind, 'redeemed');
  assert.equal(calls[3].args.p_expected_revision, 2);
});

test('alteração com reconsulta indisponível bloqueia outro resgate', async () => {
  const calls = [];
  const session = createVoucherSession(nextResult([
    found(), { data: { ok: false, reason: 'changed' }, error: null },
    { data: { ok: false, reason: 'rate_limited' }, error: null },
  ], calls));
  await session.lookup(base.code);
  assert.deepEqual(await session.redeem(true), { kind: 'refused', reason: 'changed' });
  assert.equal(session.state.voucher, null);
  assert.equal(session.state.needsRefresh, true);
  assert.equal((await session.redeem(true)).kind, 'refresh_required');
  assert.equal(calls.filter(({ name }) => name === 'benefit_voucher_redeem').length, 1);
});

test('falha de rede ao atualizar voucher alterado preserva recusa e remove dados antigos', async () => {
  const calls = [];
  const session = createVoucherSession(nextResult([
    found(), { data: { ok: false, reason: 'changed' }, error: null }, new Error('network'),
  ], calls));
  await session.lookup(base.code);
  assert.deepEqual(await session.redeem(true), { kind: 'refused', reason: 'changed' });
  assert.equal(session.state.voucher, null);
  assert.equal(session.state.needsRefresh, true);
  assert.equal((await session.redeem(true)).kind, 'refresh_required');
  assert.deepEqual(calls.map(({ name }) => name), ['benefit_voucher_lookup', 'benefit_voucher_redeem', 'benefit_voucher_lookup']);
});

test('revisão ausente ou inválida impede consultar e resgatar', async () => {
  for (const revision of [undefined, null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    const calls = [];
    const session = createVoucherSession(nextResult([found({ revision })], calls));
    assert.equal((await session.lookup(base.code)).kind, 'lookup_failed');
    assert.equal(session.state.voucher, null);
    assert.equal((await session.redeem(true)).kind, 'refresh_required');
    assert.deepEqual(calls.map(({ name }) => name), ['benefit_voucher_lookup']);
  }
});

test('resposta de uso com outra revisão não confirma o benefício como aplicado', async () => {
  const calls = [];
  const session = createVoucherSession(nextResult([
    found(), found({ revision: 2, status: 'used' }), found({ revision: 2, status: 'used' }),
  ], calls));
  await session.lookup(base.code);
  assert.equal((await session.redeem(true)).kind, 'uncertain');
  assert.equal(session.state.voucher.revision, 2);
  assert.equal(session.state.needsRefresh, true);
  assert.equal(calls.filter(({ name }) => name === 'benefit_voucher_redeem').length, 1);
});

for (const status of ['used', 'expired', 'cancelled']) {
  test(`voucher ${status} não envia resgate`, async () => {
    const calls = [];
    const session = createVoucherSession(nextResult([found({ status })], calls));
    await session.lookup(base.code);
    assert.equal((await session.redeem(true)).kind, 'refresh_required');
    assert.equal(calls.length, 1);
    assert.notEqual(voucherStatus(status).label, 'Disponível');
  });
}

test('recusa por concorrência atualiza a situação sem tentar novo resgate', async () => {
  const calls = [];
  const session = createVoucherSession(nextResult([
    found(), { data: { ok: false, reason: 'used', voucher: null }, error: null }, found({ status: 'used' }),
  ], calls));
  await session.lookup(base.code);
  assert.deepEqual(await session.redeem(true), { kind: 'refused', reason: 'used' });
  assert.equal(session.state.voucher.status, 'used');
  assert.deepEqual(calls.map(({ name }) => name), ['benefit_voucher_lookup', 'benefit_voucher_redeem', 'benefit_voucher_lookup']);
});

test('resposta perdida após gravação mostra estado usado e bloqueia novo resgate', async () => {
  const calls = [];
  const session = createVoucherSession(nextResult([found(), new Error('network'), found({ status: 'used' })], calls));
  await session.lookup(base.code);
  assert.equal((await session.redeem(true)).kind, 'uncertain');
  assert.equal(session.state.voucher.status, 'used');
  assert.equal(session.state.needsRefresh, true);
  assert.equal((await session.redeem(true)).kind, 'refresh_required');
  assert.equal(calls.filter(({ name }) => name === 'benefit_voucher_redeem').length, 1);
});

test('erro de rede com voucher ainda disponível exige nova consulta manual', async () => {
  const calls = [];
  const session = createVoucherSession(nextResult([found(), new Error('network'), found(), found()], calls));
  await session.lookup(base.code);
  assert.equal((await session.redeem(true)).kind, 'uncertain');
  assert.equal(session.state.voucher.status, 'available');
  assert.equal((await session.redeem(true)).kind, 'refresh_required');
  assert.equal((await session.lookup(base.code)).kind, 'found');
  assert.equal(session.state.needsRefresh, false);
});

test('indisponibilidade também na atualização remove os dados antigos', async () => {
  const calls = [];
  const session = createVoucherSession(nextResult([found(), new Error('network'), new Error('network')], calls));
  await session.lookup(base.code);
  assert.equal((await session.redeem(true)).kind, 'uncertain');
  assert.equal(session.state.voucher, null);
  assert.equal(session.state.needsRefresh, true);
  assert.equal(session.state.busy, false);
});

for (const reason of ['not_found', 'rate_limited', 'invalid_code']) {
  test(`resposta ${reason} limpa voucher anterior`, async () => {
    const session = createVoucherSession(nextResult([found(), { data: { ok: false, reason }, error: null }], []));
    await session.lookup(base.code);
    assert.equal((await session.lookup(base.code)).kind, reason);
    assert.equal(session.state.voucher, null);
  });
}

test('permissão negada não disponibiliza voucher nem revela erro bruto', async () => {
  const session = createVoucherSession(async () => ({ data: null, error: { code: '42501', message: 'detalhe interno' } }));
  assert.deepEqual(await session.lookup(base.code), { kind: 'denied' });
  assert.equal(session.state.voucher, null);
});

test('resposta incompleta não permite uso; limpar consulta remove disponibilidade anterior', async () => {
  const session = createVoucherSession(nextResult([found(), found({ benefit_type: 'outro' })], []));
  await session.lookup(base.code);
  session.clear();
  assert.equal(session.state.voucher, null);
  assert.equal((await session.redeem(true)).kind, 'refresh_required');
  assert.equal((await session.lookup(base.code)).kind, 'lookup_failed');
  assert.equal(session.state.voucher, null);
});

test('resposta de outro código não é apresentada como resultado da consulta', async () => {
  const session = createVoucherSession(nextResult([found({ code: 'SF-MNPQ-RSTV-WXYZ' })], []));
  assert.equal((await session.lookup(base.code)).kind, 'lookup_failed');
  assert.equal(session.state.voucher, null);
});

test('resgate que responde outro UUID não é confirmado como sucesso', async () => {
  const calls = [];
  const session = createVoucherSession(nextResult([
    found(), found({ id: '22222222-2222-4222-8222-222222222222', status: 'used' }), found(),
  ], calls));
  await session.lookup(base.code);
  assert.equal((await session.redeem(true)).kind, 'uncertain');
  assert.equal(session.state.needsRefresh, true);
  assert.equal(session.state.voucher.id, base.id);
  assert.equal(calls.filter(({ name }) => name === 'benefit_voucher_redeem').length, 1);
});
