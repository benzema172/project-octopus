create index if not exists leave_requests_employee_workspace_date_idx
  on public.leave_requests (employee_id, workspace_id, date_from, date_to);
