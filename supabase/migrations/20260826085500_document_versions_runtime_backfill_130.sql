-- Project Octopus 1.3.0 — make extraction lifecycle explicit in clean migration chains.
-- Production already contains extraction_status; ADD IF NOT EXISTS closes historical schema drift.

alter table public.document_versions
  add column if not exists extraction_status text;

update public.document_versions
set extraction_status = case
  when extraction_status is not null then extraction_status
  when upload_status in ('failed','error') then 'failed'
  when upload_status in ('uploaded','complete','completed') then 'pending'
  else 'pending'
end
where extraction_status is null;
