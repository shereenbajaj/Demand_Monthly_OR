-- Push notifications for the Demand monthly dashboard.
-- Run once in the Supabase SQL editor.
--
-- WHAT THIS DOES
--   Whenever a row in demand_monthly_summary changes, a bare "something changed"
--   ping is broadcast on a Realtime channel. The dashboard hears the ping and
--   re-fetches through /api/demand, which is the only thing that ever reads the
--   actual numbers.
--
-- WHAT THIS DOES NOT DO
--   It does not make demand_monthly_summary readable by anyone. RLS stays on
--   with no policies. The ping payload carries a timestamp and nothing else —
--   no row data, no amounts. A browser holding the publishable key can join the
--   channel and learn that the table changed; it cannot read the table.

-- 1. Let clients receive (but not send) on this one channel.
--    realtime.messages has RLS on; this grants SELECT for our topic only.
drop policy if exists "demand dashboard can receive change pings" on realtime.messages;

create policy "demand dashboard can receive change pings"
  on realtime.messages
  for select
  to anon, authenticated
  using (
    realtime.topic() = 'demand-updates'
    and realtime.messages.extension = 'broadcast'
  );

-- 2. Broadcast a bare ping on any change.
create or replace function public.demand_summary_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('at', now()),  -- payload: timestamp only, never row data
    'changed',                        -- event name the dashboard listens for
    'demand-updates',                 -- topic
    true                              -- private channel, so the policy above applies
  );
  return null;
end;
$$;

drop trigger if exists demand_summary_changed_trg on public.demand_monthly_summary;

-- Statement-level: a batch rebuild of all 60 rows fires one ping, not 60.
create trigger demand_summary_changed_trg
  after insert or update or delete on public.demand_monthly_summary
  for each statement
  execute function public.demand_summary_changed();

-- 3. Check it works. Run this, and an open dashboard should refresh within a second.
--    select realtime.send(jsonb_build_object('at', now()), 'changed', 'demand-updates', true);

-- TO UNDO
--   drop trigger if exists demand_summary_changed_trg on public.demand_monthly_summary;
--   drop function if exists public.demand_summary_changed();
--   drop policy if exists "demand dashboard can receive change pings" on realtime.messages;
