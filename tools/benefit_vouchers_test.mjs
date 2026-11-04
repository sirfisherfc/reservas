import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVoucherSession, normalizeVoucherCode, voucherBenefit, voucherDate,
  voucherEventTime, voucherStatus,
} from '../assets/js/benefit-vouchers.mjs';

const base = {
  id: '11111111-1111-4111-8111-111111111111', code: 'SF-0123-ABCD-WXYZ',
  beneficiary_name: 'Beneficiário de teste com nome bastante longo para conferência',
  benefit_type: 'fixed', benefit_value: 250.5, expires_on: '2026-12-04',
  status: 'available', unit_name: 'Sir Fisher', conditions: ['Uso único.'],
};
const found = (overrides = {}) => ({ data: { ok: true, voucher: { ...base, ...overrides } }, error: null });
const nextResult = (queue, calls) => async (name, args) => {
  calls.push({ name, args });
  const result = queue.shift();
  if (result instanceof Error) throw result;
  return result;
};

test('aceita código legível colado e rejeita dados incompletos/URL', () => {
  assert.equal(normalizeVoucherCode(' sf 0123 abcd wxyz '), base.code);
  assert.equal(normalizeVoucherCode('sf0123abcdwxyz'), base.code);
  assert.equal(normalizeVoucherCode('0123ABCDWXYZ'), base.code);
  assert.equal(normalizeVoucherCode('SF-0000-1111-2222'), 'SF-0000-1111-2222');
  assert.equal(normalizeVoucherCode('SF-OIL0-ABCD-WXYZ'), 'SF-0110-ABCD-WXYZ');
  for (const bad of ['', 'SF-ABCD', 'SF-0123-ABCD-WXYZ-Z', 'SF-0123-ABCD-WXYU', `https://example.test/#${base.code}`]) {
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
  assert.equal((await session.lookup('SF-ABCD')).kind, 'invalid_code');
  assert.equal(calls.length, 0);
  assert.equal((await session.lookup('sf-oi23-abcd-wxyz')).kind, 'found');
  assert.equal(session.state.voucher.beneficiary_name, base.beneficiary_name);
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
  assert.deepEqual(calls[1], { name: 'benefit_voucher_redeem', args: { p_id: base.id, p_confirm: true } });
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
