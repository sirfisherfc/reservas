// Vouchers de benefício: formatação e estado de consulta/resgate.
// A disponibilidade e as permissões são sempre determinadas pelas RPCs.
const STATUSES = new Set(['available', 'used', 'expired', 'cancelled']);
const SHORT_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{6}$/;
const CODE_PATTERN = /^SF-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export function normalizeVoucherCode(value) {
  const raw = String(value ?? '');
  if (raw.length > 40) return null;
  let compact = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  if (compact.startsWith('SF') && compact.length === 14) compact = compact.slice(2);
  compact = compact.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (SHORT_CODE_PATTERN.test(compact)) return compact;
  if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(compact)) return null;
  const code = `SF-${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}`;
  return CODE_PATTERN.test(code) ? code : null;
}

export function voucherBenefit(voucher) {
  const value = Number(voucher?.benefit_value);
  if (!Number.isFinite(value) || value <= 0) return 'Benefício indisponível';
  if (voucher.benefit_type === 'percent') {
    return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% de desconto`;
  }
  if (voucher.benefit_type === 'fixed') {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  return 'Benefício indisponível';
}

export function voucherDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Data indisponível';
}

export function voucherEventTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Horário indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value));
}

export function voucherStatus(status) {
  return {
    available: { label: 'Disponível', description: 'Confira as condições e confirme a utilização somente ao aplicar o benefício na conta.' },
    used: { label: 'Utilizado', description: 'Este voucher já foi utilizado e não pode ser usado novamente.' },
    expired: { label: 'Vencido', description: 'A validade terminou. Este voucher não pode ser utilizado.' },
    cancelled: { label: 'Cancelado', description: 'Este voucher foi cancelado e não pode ser utilizado.' },
  }[status] || { label: 'Situação indisponível', description: 'Consulte novamente antes de aplicar o benefício.' };
}

function readVoucher(payload) {
  const value = payload?.voucher;
  if (!value || typeof value.id !== 'string' || !normalizeVoucherCode(value.code)
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !STATUSES.has(value.status) || !['fixed', 'percent'].includes(value.benefit_type)
    || !Number.isFinite(Number(value.benefit_value)) || Number(value.benefit_value) <= 0
    || typeof value.beneficiary_name !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.expires_on)) return null;
  // Whitelist: não manter telefone nem observação interna, mesmo se uma resposta
  // futura adicionar esses campos por engano.
  const code=normalizeVoucherCode(value.short_code || value.code);
  if(!code)return null;
  const legacy=normalizeVoucherCode(value.legacy_code || (CODE_PATTERN.test(value.code) ? value.code : ''));
  return {
    id: value.id, code, legacy_code: legacy && CODE_PATTERN.test(legacy) ? legacy : null, revision: value.revision,
    beneficiary_name: value.beneficiary_name,
    benefit_type: value.benefit_type, benefit_value: Number(value.benefit_value),
    expires_on: value.expires_on, status: value.status,
    conditions: Array.isArray(value.conditions) ? value.conditions.filter((item) => typeof item === 'string') : [],
    unit_name: typeof value.unit_name === 'string' ? value.unit_name : '',
    created_at: value.created_at, used_at: value.used_at,
    used_by_name: typeof value.used_by_name === 'string' ? value.used_by_name : '',
    cancelled_at: value.cancelled_at,
  };
}

export const RECENT_VOUCHERS_PAGE_SIZE = 20;

export function createRecentVoucherList(rpc) {
  const state = { items: [], total: 0, offset: 0, busy: false };
  let serial = 0;
  return {
    state,
    async load(offset = 0) {
      if (!Number.isSafeInteger(offset) || offset < 0) return { kind: 'invalid_page' };
      const request = ++serial;
      state.busy = true;
      try {
        const { data, error } = await rpc('benefit_voucher_recent', { p_offset: offset, p_limit: RECENT_VOUCHERS_PAGE_SIZE });
        if (error) throw error;
        if (data?.ok !== true) {
          if (data?.reason === 'rate_limited') throw Object.assign(new Error(), { code: 'rate_limited' });
          throw new Error('Invalid recent response');
        }
        if (!Array.isArray(data.items) || data.items.length > RECENT_VOUCHERS_PAGE_SIZE
          || !Number.isSafeInteger(data.total) || data.total < data.items.length) throw new Error('Invalid recent response');
        const items = data.items.map((item) => {
          const code = normalizeVoucherCode(item?.code);
          if (!code || !SHORT_CODE_PATTERN.test(code) || typeof item.beneficiary_name !== 'string'
            || !['fixed', 'percent'].includes(item.benefit_type) || !Number.isFinite(Number(item.benefit_value))
            || Number(item.benefit_value) <= 0 || !item.used_at || !Number.isFinite(new Date(item.used_at).getTime())
            || typeof item.used_by_name !== 'string') throw new Error('Invalid recent item');
          return { code, beneficiary_name: item.beneficiary_name, benefit_type: item.benefit_type,
            benefit_value: Number(item.benefit_value), used_at: item.used_at, used_by_name: item.used_by_name };
        });
        if (request !== serial) return { kind: 'superseded' };
        Object.assign(state, { items, total: data.total, offset });
        return { kind: 'loaded' };
      } catch (error) {
        if (request !== serial) return { kind: 'superseded' };
        Object.assign(state, { items: [], total: 0, offset: 0 });
        return { kind: error?.code === '42501' ? 'denied' : error?.code === 'rate_limited' ? 'rate_limited' : 'failed' };
      } finally {
        if (request === serial) state.busy = false;
      }
    },
  };
}

export function createVoucherSession(rpc) {
  const state = { voucher: null, busy: false, needsRefresh: false };

  async function query(code) {
    const { data, error } = await rpc('benefit_voucher_lookup', { p_code: code });
    if (error) throw error;
    if (data?.ok === true) {
      const voucher = readVoucher(data);
      if (!voucher || voucher.code !== code && voucher.legacy_code !== code) throw new Error('Invalid voucher response');
      return { kind: 'found', voucher };
    }
    if (['not_found', 'rate_limited', 'invalid_code'].includes(data?.reason)) return { kind: data.reason };
    throw new Error('Invalid lookup response');
  }

  return {
    state,
    clear() {
      if (state.busy) return;
      state.voucher = null;
      state.needsRefresh = false;
    },
    async lookup(input) {
      if (state.busy) return { kind: 'busy' };
      const code = normalizeVoucherCode(input);
      state.voucher = null;
      state.needsRefresh = false;
      if (!code) return { kind: 'invalid_code' };
      state.busy = true;
      try {
        const result = await query(code);
        state.voucher = result.voucher || null;
        return result;
      } catch (error) {
        state.needsRefresh = true;
        return { kind: error?.code === '42501' ? 'denied' : 'lookup_failed' };
      } finally {
        state.busy = false;
      }
    },
    async redeem(confirmed) {
      if (state.busy) return { kind: 'busy' };
      if (confirmed !== true) return { kind: 'confirmation_required' };
      const voucher = state.voucher;
      if (!voucher || voucher.status !== 'available' || state.needsRefresh
        || !Number.isSafeInteger(voucher.revision) || voucher.revision < 1) return { kind: 'refresh_required' };
      state.busy = true;
      try {
        const { data, error } = await rpc('benefit_voucher_redeem', {
          p_id: voucher.id, p_confirm: true, p_expected_revision: voucher.revision,
        });
        if (error) throw error;
        const updated = readVoucher(data);
        if (data?.ok === true && updated?.status === 'used' && updated.id === voucher.id
          && updated.code === voucher.code && updated.revision === voucher.revision) {
          state.voucher = updated;
          return { kind: 'redeemed' };
        }
        if (!['used', 'expired', 'cancelled', 'not_found', 'rate_limited', 'changed'].includes(data?.reason)) {
          throw new Error('Invalid redeem response');
        }
        // Mesmo numa recusa conhecida, atualizar antes de permitir outra ação.
        state.voucher = null;
        state.needsRefresh = true;
        try {
          const result = await query(voucher.code);
          state.voucher = result.voucher || null;
          state.needsRefresh = result.kind !== 'found';
        } catch {
          // A recusa já foi confirmada. Falha na consulta seguinte não autoriza
          // reaproveitar os dados anteriores nem precisa repetir a operação.
        }
        return { kind: 'refused', reason: data.reason };
      } catch (error) {
        state.needsRefresh = true;
        // Um erro de rede não prova se houve gravação. Só consultar novamente;
        // nunca reenviar o resgate automaticamente.
        try {
          const result = await query(voucher.code);
          state.voucher = result.voucher || null;
        } catch {
          state.voucher = null;
        }
        return { kind: error?.code === '42501' ? 'denied' : 'uncertain' };
      } finally {
        state.busy = false;
      }
    },
  };
}
