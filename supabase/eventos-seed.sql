-- Parâmetros provisórios. Ativar uma nova versão é decisão explícita do proprietário.

insert into public.event_pricing_versions
  (code, status, cmv_rate, service_rate, target_contribution_margin, freelancer_day, public_notes, internal_notes)
values
  ('eventos-2026-09-mvp-1', 'active', 0.35, 0.10, 0.52, 100,
   'Valores com atendimento incluído.',
   'CMV provisório de 35%; substituir por custo real por produto quando disponível.')
on conflict (code) do update set
  cmv_rate = excluded.cmv_rate,
  service_rate = excluded.service_rate,
  target_contribution_margin = excluded.target_contribution_margin,
  freelancer_day = excluded.freelancer_day;

with version as (
  select id from public.event_pricing_versions where code = 'eventos-2026-09-mvp-1'
), rules(food_style, profile, units, retail, labor, composition) as (
  values
    ('petiscos','essencial',5.0,23.0,7.0,'{"pasteizinhos":0.15,"bolinha_peixe":0.1667,"crocante_carne_sol":0.1667,"dadinho_tapioca":0.125}'::jsonb),
    ('petiscos','equilibrada',6.5,34.0,8.0,'{"pasteizinhos":0.18,"bolinha_peixe":0.2,"crocantes":0.2,"dadinho_tapioca":0.15,"crispy_chicken":0.12}'::jsonb),
    ('petiscos','completa',8.0,46.0,10.0,'{"pasteizinhos":0.2,"bolinha_peixe":0.22,"newcastle":0.16,"crocantes":0.2,"dadinho_tapioca":0.17,"isca_peixe":0.12}'::jsonb),
    ('petiscos_principal','essencial',4.5,56.0,9.0,'{"pasteizinhos":0.14,"crocante_carne_sol":0.17,"dadinho_tapioca":0.12,"principal":0.75}'::jsonb),
    ('petiscos_principal','equilibrada',6.0,66.0,10.0,'{"pasteizinhos":0.16,"bolinha_peixe":0.17,"crocantes":0.17,"dadinho_tapioca":0.14,"principal":0.85}'::jsonb),
    ('petiscos_principal','completa',7.5,81.0,12.0,'{"pasteizinhos":0.18,"bolinha_peixe":0.18,"newcastle":0.14,"crocantes":0.18,"dadinho_tapioca":0.15,"principal":1,"brownie":1}'::jsonb),
    ('refeicao','essencial',3.0,52.0,9.0,'{"dadinho_tapioca":0.1,"acompanhamento":0.12,"principal":0.8}'::jsonb),
    ('refeicao','equilibrada',4.0,66.0,10.0,'{"pasteizinhos":0.12,"dadinho_tapioca":0.12,"principal":1,"brownie":1}'::jsonb),
    ('refeicao','completa',5.0,86.0,13.0,'{"pasteizinhos":0.14,"bolinha_peixe":0.14,"dadinho_tapioca":0.12,"principal_premium":1,"sobremesa":1}'::jsonb)
)
insert into public.event_package_rules
  (pricing_version_id, food_style, profile, guest_min, guest_max, food_units_per_person, retail_per_person, kitchen_labor_per_person, composition)
select version.id, rules.food_style, rules.profile, band.min_guest, band.max_guest,
  rules.units, rules.retail, rules.labor, rules.composition
from version cross join rules cross join (values (30,40),(41,60),(61,80),(81,100)) band(min_guest,max_guest)
on conflict (pricing_version_id, food_style, profile, guest_min, guest_max) do update set
  food_units_per_person = excluded.food_units_per_person,
  retail_per_person = excluded.retail_per_person,
  kitchen_labor_per_person = excluded.kitchen_labor_per_person,
  composition = excluded.composition,
  active = true;

with version as (
  select id from public.event_pricing_versions where code = 'eventos-2026-09-mvp-1'
), rules(mode, retail, units, waste, validation, composition) as (
  values
    ('individual',0.0,0.0,0.0,false,'{}'::jsonb),
    ('sem_alcool',13.0,1.7,0.04,false,'{"agua":0.7,"refrigerante":0.7,"suco":0.3}'::jsonb),
    ('credito',22.0,0.0,0.0,false,'{"credito_reais":22}'::jsonb),
    ('fichas',20.0,2.0,0.03,false,'{"fichas":2}'::jsonb),
    ('chope',26.0,2.4,0.10,true,'{"chope":2.4}'::jsonb),
    ('selecionado',31.0,2.5,0.10,true,'{"agua_refrigerante":1,"cerveja_ou_chope":1.5}'::jsonb),
    ('open_bar',55.0,4.2,0.18,true,'{"agua_refrigerante":1.2,"alcoolicas_selecionadas":3}'::jsonb)
)
insert into public.event_beverage_rules
  (pricing_version_id, mode, retail_per_adult, units_per_adult, waste_risk, needs_validation, composition)
select version.id, rules.mode, rules.retail, rules.units, rules.waste, rules.validation, rules.composition
from version cross join rules
on conflict (pricing_version_id, mode) do update set
  retail_per_adult = excluded.retail_per_adult,
  units_per_adult = excluded.units_per_adult,
  waste_risk = excluded.waste_risk,
  needs_validation = excluded.needs_validation,
  composition = excluded.composition,
  active = true;

with classified(classification, batch_friendly, max_guests, rationale, ids) as (
  values
    ('recommended', true, 100, 'Produção padronizada ou bebida estável, adequada a volume.', array[
      'bolinha-de-peixe-cremosa','newcastle','crocante-carne-de-sol','crocante-calabresa','pasteizinhos','crispy-spicy-chicken','dadinho-de-tapioca','isca-de-peixe','brownie-de-chocolate',
      'spaten-longneck','stella-artois-longneck','corona-longneck','corona-zero-longneck','spaten-600','original-600','budweiser-600','stella-artois-600','stella-pure-gold-600',
      'agua-sem-gas','agua-com-gas','agua-de-coco-copo','agua-tonica','refrigerante-lata','suco-copo','soda-italiana'
    ]::text[]),
    ('limited', false, 60, 'Viável com limite de volume ou janela de serviço para preservar qualidade.', array[
      'sir-fisher-fish-n-chips','london-fish-n-chips','big-ben-fries','caldo-de-peixe','camarao-alho-e-oleo','calabresa-acebolada-com-fritas','macaxeira-ou-batata-frita',
      'fisher-burger','edimburger','marine-sandwich','peito-de-frango-com-ervas','picanha-suina','brownie-com-sorvete','chope-brahma','smirnoff-ice','energetico-red-bull',
      'caipirinha','caipiroska','caipifruta','gin-tonica','melancita','sherlock-holmes-gin','tropicall','margarita','fitzgerald','moscow-mule'
    ]::text[]),
    ('approval', false, null, 'Maior custo, complexidade, perecibilidade ou risco de serviço; requer validação.', array[
      'patinha-de-caranguejo','file-mignon-trinchado','file-mignon-dividir','picanha-importada','file-de-peixe-grelhado','carne-de-sol-acebolada',
      'teachers','black-white','red-label','black-label','rum','campari','martini','vodka-nacional','vodka-sky','vodka-absolut','gin-nacional','gin-gordons','aperol','conhaque','cachaca-nacional','cachaca-ypioca-150','cachaca-premium','rolha'
    ]::text[]),
    ('not_recommended', false, null, 'Não compõe pacote padrão; uso avulso, apoio operacional ou baixa adequação ao serviço volante.', array[
      'cafe-expresso','sumo-de-limao','molho-extra','arroz-extra','pacote-gelo','embalagem-viagem'
    ]::text[])
), expanded as (
  select classification, batch_friendly, max_guests, rationale, unnest(ids) as product_id from classified
)
insert into public.event_product_rules(menu_version, product_id, classification, batch_friendly, max_guests, rationale)
select 'cardapio-1-2026-09-22', product_id, classification, batch_friendly, max_guests, rationale from expanded
on conflict (menu_version, product_id) do update set
  classification = excluded.classification,
  batch_friendly = excluded.batch_friendly,
  max_guests = excluded.max_guests,
  rationale = excluded.rationale,
  active = true;

do $$
declare v_count int;
begin
  select count(*) into v_count from public.event_product_rules where menu_version = 'cardapio-1-2026-09-22';
  if v_count <> 81 then
    raise exception 'Classificação de cardápio incompleta: esperado 81, encontrado %', v_count;
  end if;
end $$;
