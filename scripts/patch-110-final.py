from pathlib import Path

route_path = Path('app/api/company/records/route.ts')
route = route_path.read_text(encoding='utf-8')
start = route.index('async function createReportSnapshot(')
end = route.index('\nexport async function POST', start)
replacement = '''async function createReportSnapshot(workspaceId: string, userId: string, payload: Record<string, unknown>) {
  const definitionId = await requireOwnedId("report_definitions", payload.definitionId, workspaceId, "Definicja raportu");
  const periodStart = date(payload.periodStart);
  const periodEnd = date(payload.periodEnd);
  if (periodStart && periodEnd && periodStart > periodEnd) throw new Error("Początek okresu raportu nie może być późniejszy niż koniec.");
  const { data, error } = await createServiceSupabaseClient().rpc("generate_report_snapshot_atomic", {
    p_workspace_id: workspaceId,
    p_definition_id: definitionId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_actor_id: userId
  });
  if (error || !data) throw new Error(`Nie udało się atomowo wygenerować raportu: ${error?.message ?? "brak danych"}`);
  return String(data);
}
'''
route = route[:start] + replacement + route[end:]
route_path.write_text(route, encoding='utf-8')

migration_path = Path('supabase/migrations/20260818100000_110_operating_scale.sql')
sql = migration_path.read_text(encoding='utf-8')
old_sale = "left join lateral(select coalesce(sum(greatest(i.gross_amount-i.paid_amount,0)),0)::numeric inflow from public.invoices i join public.financial_allocations fa on fa.source_type='invoice' and fa.source_id=i.id and fa.workspace_id=i.workspace_id and fa.status='approved' where i.workspace_id=p_workspace_id and fa.project_id=p_project_id and i.direction='sale' and coalesce(i.due_date,i.issue_date)>=w.week_start and coalesce(i.due_date,i.issue_date)<w.week_start+7) s on true"
new_sale = "left join lateral(select coalesce(sum(greatest(i.gross_amount-i.paid_amount,0)),0)::numeric inflow from public.invoices i where i.workspace_id=p_workspace_id and i.direction='sale' and coalesce(i.due_date,i.issue_date)>=w.week_start and coalesce(i.due_date,i.issue_date)<w.week_start+7 and exists(select 1 from public.financial_allocations fa where fa.workspace_id=i.workspace_id and fa.source_type='invoice' and fa.source_id=i.id and fa.status='approved' and fa.project_id=p_project_id)) s on true"
old_purchase = "left join lateral(select coalesce(sum(greatest(i.gross_amount-i.paid_amount,0)),0)::numeric outflow from public.invoices i join public.financial_allocations fa on fa.source_type='invoice' and fa.source_id=i.id and fa.workspace_id=i.workspace_id and fa.status='approved' where i.workspace_id=p_workspace_id and fa.project_id=p_project_id and i.direction='purchase' and coalesce(i.due_date,i.issue_date)>=w.week_start and coalesce(i.due_date,i.issue_date)<w.week_start+7) p on true"
new_purchase = "left join lateral(select coalesce(sum(greatest(i.gross_amount-i.paid_amount,0)),0)::numeric outflow from public.invoices i where i.workspace_id=p_workspace_id and i.direction='purchase' and coalesce(i.due_date,i.issue_date)>=w.week_start and coalesce(i.due_date,i.issue_date)<w.week_start+7 and exists(select 1 from public.financial_allocations fa where fa.workspace_id=i.workspace_id and fa.source_type='invoice' and fa.source_id=i.id and fa.status='approved' and fa.project_id=p_project_id)) p on true"
if old_sale not in sql or old_purchase not in sql:
    raise SystemExit('Expected cashflow allocation queries not found; refusing blind patch.')
sql = sql.replace(old_sale, new_sale).replace(old_purchase, new_purchase)
migration_path.write_text(sql, encoding='utf-8')

test_path = Path('tests/stability-1.1.test.ts')
test = test_path.read_text(encoding='utf-8')
test = test.replace('full 22-migration validator', 'full 23-migration validator')
test = test.replace('expect(sql).toContain("generate_report_snapshot_atomic");', 'expect(sql).toContain("generate_report_snapshot_atomic");\n    const route=read("app/api/company/records/route.ts");\n    expect(route).toContain(\'.rpc("generate_report_snapshot_atomic"\');')
test = test.replace('expect(sql).toContain("\'financeCoverage\'");', 'expect(sql).toContain("\'financeCoverage\'");\n    expect(sql).toContain("exists(select 1 from public.financial_allocations fa");')
test_path.write_text(test, encoding='utf-8')
