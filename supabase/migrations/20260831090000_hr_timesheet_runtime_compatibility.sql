-- Kadry 1.6: zgodność runtime ewidencji czasu pracy z API.
-- Pola są używane przez edytor czasu pracy oraz ścieżkę ponownej akceptacji.

alter table public.timesheets
  add column if not exists note text,
  add column if not exists approved_at timestamptz;

comment on column public.timesheets.note is 'Uwagi do wpisu czasu pracy / zakresu wykonanych prac.';
comment on column public.timesheets.approved_at is 'Czas ostatniego zatwierdzenia wpisu czasu pracy; zerowany przy ponownej edycji.';
