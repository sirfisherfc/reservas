# Cron, fila de conversões e o job do recálculo de saldo

**Analisado em 07/09/2026.** Registro de duas decisões: uma aplicada, outra pendente da sua palavra.

---

## 1. A fila de conversões: de 5 em 5 minutos para gatilho + rede horária

### O que mudou

| | Antes | Depois |
|---|---|---|
| Cadência do cron | `*/5 * * * *` | `0 * * * *` |
| Gatilho | não existia | `AFTER INSERT ... FOR EACH STATEMENT` em `ad_conversion_events` |
| Execuções por dia | 288 | ~25 (24 do cron + ~1,4 de gatilho) |
| Latência típica | até 5 min | **segundos** |

Melhorou nas duas pontas ao mesmo tempo: 91% menos execuções **e** entrega mais rápida.

Arquivo: `reservas/supabase/conversions-drain.sql`.

### Por que 5 minutos não se justificava

Os prazos reais dos três provedores são muito mais folgados do que eu supus:

| Provedor | Prazo real |
|---|---|
| Meta CAPI — janela de desduplicação | **48 horas** |
| Meta CAPI — descarte definitivo | 7 dias |
| GA4 Measurement Protocol | **72 horas** (`timestamp_micros`) |

Com ~1,4 reservas/dia pelo site, o algoritmo do Meta não reage minuto a minuto. O ganho de 5 sobre 15 ou 60 minutos era **zero**.

### O custo que era real (e o que não era)

Em fatura, desprezível: 288 execuções/dia = ~8.760/mês, contra 500 mil do tier gratuito. **Menos de 2%.**

O custo real era outro: **~8.760 linhas de log/mês**, quase todas de execução vazia, mais ~26 mil consultas ociosas ao banco (a função faz 3 chamadas, uma por provedor, mesmo com fila vazia). Esse ruído atrapalha justamente quando é preciso achar um erro de verdade — foi no `function_logs` que diagnostiquei o BOOT_ERROR da edge function em 06/09.

### A armadilha de restringir por horário

A ideia de "não rodar de madrugada" é intuitiva e **perigosa aqui**:

```
show timezone  →  UTC
```

O pg_cron obedece o fuso do **banco**, não o de Fortaleza (UTC−3). Então `*/5 8-23 * * *` significaria **5h às 20h locais** — cortando fora o jantar e o pôr do sol, que é o pico da casa. Para acertar seria preciso escrever `11-23,0-2`, ilegível e quebradiço.

E economizaria menos: cortar 8 horas remove 33%; desacelerar a cadência removeu 91%.

Dados de apoio — reservas criadas por hora, 12 meses:
- **00h–07h: 15 de 316 (4,7%)**, com zero às 02h, 04h e 07h
- 08h–23h: 301 (95,3%)

Pouco, mas não é nada — e não havia motivo para tratá-las diferente quando a alternativa era melhor em tudo.

### Duas correções ao que eu tinha escrito antes

1. **A "corrida entre commit e chamada HTTP" não existe.** Eu havia justificado o cron alegando que um gatilho teria essa corrida. Está errado para o `pg_net`: ele **enfileira** a requisição dentro da transação e um worker de fundo só despacha o que já foi commitado.

2. **`exception when others then null` era um erro meu.** Escondia um gatilho quebrado para sempre — a fila continuaria drenando de hora em hora e ninguém notaria. Agora é `raise warning`: o erro vai para o log do Postgres sem derrubar a reserva do cliente.

### Por que não há envio duplicado

Se o cron e o gatilho coincidirem, as funções `fn_claim_pending_*` usam `FOR UPDATE SKIP LOCKED` — a segunda execução simplesmente não enxerga as linhas que a primeira já reivindicou.

### Como foi verificado

| Execução do cron antigo | Resposta HTTP correspondente |
|---|---|
| há 917s | há 886s |
| há 617s | há 586s |
| há 317s ← última | há 286s |
| *nenhuma* | **há 123s** ← o gatilho |

A resposta de 123s atrás (HTTP 200) não tem execução de cron correspondente. O gatilho dispara e a cadeia `security definer` funciona.

---

## 2. O job de 2 minutos: **não desabilitar**

`sirfisher-garantir-worker-recalculo-saldo`, `*/2 * * * *`.

### O que é

É a **rede de recuperação da importação do CSV da Stone**, do projeto `gestao`. Quando um extrato é importado, `importar_csv_stone` enfileira um recálculo de saldo na mesma transação (padrão outbox); esse watchdog garante que o worker suba mesmo se o agendamento imediato falhar.

A cada 2 minutos ele pega um lock e faz **um `EXISTS`**. Só se houver fila pendente é que agenda um worker temporário de 5 em 5 segundos, que se desagenda sozinho ao esvaziar.

### Foi autorizado — está versionado

```
gestao/supabase/migrations/20260759000000_recalculo_saldo_cron_sob_demanda.sql
gestao/supabase/migrations/20260905000000_importacao_recalculo_duravel.sql
gestao/scripts/ci/test_importacao_outbox.py          ← tem teste de CI
gestao/docs/AUDITORIA_FINANCEIRA_TECNICA_2026-09-05.md
```

Entrou junto da auditoria financeira de 05/09/2026, como detalhe de implementação. Solto ele não está.

### Se for desabilitado

Importar um extrato da Stone → o saldo nunca recalcula → **o painel financeiro passa a mostrar número errado, em silêncio.**

A própria migration avisa, textualmente: *"Em manutenção, pausar também sirfisher-garantir-worker-recalculo-saldo"* — ou seja, pausar **apenas em manutenção**, deliberadamente.

### Duas correções ao que eu disse

1. **"2,5× mais que o meu" foi enganoso.** As 720 execuções dele são SQL local puro. As 288 do meu faziam uma chamada HTTP a uma edge function. Por execução, o meu era muito mais caro. Comparei contagem em vez de custo.

2. **Alguém já fez essa otimização.** O cabeçalho da migration `20260759` diz que ela existe para reduzir um job de 10 em 10 segundos (8.640/dia) para sob demanda. A análise que eu fiz hoje já tinha sido feita nesse job.

### Status

**Pendente da sua decisão.** Recomendo manter. Se ainda assim quiser desabilitar:

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'sirfisher-garantir-worker-recalculo-saldo'),
  active := false
);
```

Reversível trocando `false` por `true`.

---

## Estado atual dos jobs

| jobid | Nome | Cadência | Dono |
|---|---|---|---|
| 1 | `enqueue-reservation-reminders` | `0 13 * * *` | reservas |
| 2 | `sirfisher-garantir-worker-recalculo-saldo` | `*/2 * * * *` | gestao |
| 4 | `drenar-fila-conversoes` | `0 * * * *` | reservas |

> Nota: `cron.unschedule` **remove** a linha de `cron.job`, mas o histórico em `cron.job_run_details` mantém o `jobid` antigo. Um `JOIN` entre as duas tabelas esconde o histórico de jobs reagendados — consulte `job_run_details` sozinha para auditar o passado.
