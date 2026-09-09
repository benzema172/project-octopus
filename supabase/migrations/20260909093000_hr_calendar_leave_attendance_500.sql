alter table public.leave_requests
  add column if not exists source text not null default 'manual';

create index if not exists leave_requests_source_idx
  on public.leave_requests (workspace_id, source, date_from, date_to);

create unique index if not exists leave_requests_calendar_day_unique
  on public.leave_requests (workspace_id, employee_id, date_from, date_to, source)
  where source = 'calendar' and date_from = date_to;

comment on column public.leave_requests.source is 'Źródło wniosku: manual dla formularza urlopowego, calendar dla wpisu Urlop utworzonego z kalendarza kadr.';
