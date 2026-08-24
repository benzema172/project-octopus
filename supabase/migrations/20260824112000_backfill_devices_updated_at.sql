set lock_timeout = '5s';

-- The legacy devices table predates the MVP definition. Because the original
-- migration used CREATE TABLE IF NOT EXISTS, it did not add this later column
-- to already-existing projects even though application queries depend on it.
alter table public.devices
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_devices_updated_at on public.devices;
create trigger set_devices_updated_at
before update on public.devices
for each row execute function public.set_updated_at();
