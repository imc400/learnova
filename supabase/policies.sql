-- ============================================================================
-- Learnova — Trigger de perfil + Row Level Security (RLS)
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de crear las tablas
-- (pnpm db:push o pnpm db:migrate).
-- Es idempotente: se puede correr varias veces sin error.
-- ============================================================================

-- 1) Crear automáticamente un perfil cuando se registra un usuario en auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, locale, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_user_meta_data->>'preferred_language', 'es'),
    new.email
  )
  on conflict (id) do update set email = excluded.email;

  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;

  insert into public.email_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2) Habilitar RLS en todas las tablas
alter table public.profiles            enable row level security;
alter table public.learning_paths      enable row level security;
alter table public.modules             enable row level security;
alter table public.lessons             enable row level security;
alter table public.video_candidates    enable row level security;
alter table public.quizzes             enable row level security;
alter table public.questions           enable row level security;
alter table public.progress            enable row level security;
alter table public.quiz_attempts       enable row level security;
alter table public.tutor_conversations enable row level security;
alter table public.tutor_messages      enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.path_purchases      enable row level security;
alter table public.skeleton_cache      enable row level security; -- sin policy pública: solo service_role
alter table public.youtube_search_cache enable row level security; -- sin policy pública: solo service_role
alter table public.xp_events           enable row level security;
alter table public.achievements        enable row level security;
alter table public.user_achievements   enable row level security;

-- 3) Políticas — el dueño (auth.uid()) puede ver/editar lo suyo
--    (el service_role del servidor bypassa RLS para el pipeline de generación)

-- profiles
drop policy if exists "profiles_self" on public.profiles;
create policy "profiles_self" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- learning_paths
drop policy if exists "paths_owner" on public.learning_paths;
create policy "paths_owner" on public.learning_paths
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- modules (vía la ruta padre)
drop policy if exists "modules_owner" on public.modules;
create policy "modules_owner" on public.modules
  for all using (
    exists (select 1 from public.learning_paths p
            where p.id = modules.path_id and p.user_id = auth.uid())
  );

-- lessons (vía módulo → ruta)
drop policy if exists "lessons_owner" on public.lessons;
create policy "lessons_owner" on public.lessons
  for all using (
    exists (select 1 from public.modules m
            join public.learning_paths p on p.id = m.path_id
            where m.id = lessons.module_id and p.user_id = auth.uid())
  );

-- video_candidates (vía lección → módulo → ruta)
drop policy if exists "videos_owner" on public.video_candidates;
create policy "videos_owner" on public.video_candidates
  for all using (
    exists (select 1 from public.lessons l
            join public.modules m on m.id = l.module_id
            join public.learning_paths p on p.id = m.path_id
            where l.id = video_candidates.lesson_id and p.user_id = auth.uid())
  );

-- quizzes (vía lección o módulo)
drop policy if exists "quizzes_owner" on public.quizzes;
create policy "quizzes_owner" on public.quizzes
  for all using (
    exists (select 1 from public.lessons l
            join public.modules m on m.id = l.module_id
            join public.learning_paths p on p.id = m.path_id
            where l.id = quizzes.lesson_id and p.user_id = auth.uid())
    or exists (select 1 from public.modules m
            join public.learning_paths p on p.id = m.path_id
            where m.id = quizzes.module_id and p.user_id = auth.uid())
  );

-- questions (vía quiz)
drop policy if exists "questions_owner" on public.questions;
create policy "questions_owner" on public.questions
  for all using (
    exists (select 1 from public.quizzes q where q.id = questions.quiz_id)
  );

-- progress
drop policy if exists "progress_owner" on public.progress;
create policy "progress_owner" on public.progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- quiz_attempts
drop policy if exists "attempts_owner" on public.quiz_attempts;
create policy "attempts_owner" on public.quiz_attempts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- tutor_conversations
drop policy if exists "conv_owner" on public.tutor_conversations;
create policy "conv_owner" on public.tutor_conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- tutor_messages (vía conversación)
drop policy if exists "msg_owner" on public.tutor_messages;
create policy "msg_owner" on public.tutor_messages
  for all using (
    exists (select 1 from public.tutor_conversations c
            where c.id = tutor_messages.conversation_id and c.user_id = auth.uid())
  );

-- subscriptions (lectura del dueño; las escrituras las hace el server vía service_role)
drop policy if exists "subs_read_owner" on public.subscriptions;
create policy "subs_read_owner" on public.subscriptions
  for select using (user_id = auth.uid());

-- path_purchases (lectura del dueño)
drop policy if exists "purchases_read_owner" on public.path_purchases;
create policy "purchases_read_owner" on public.path_purchases
  for select using (user_id = auth.uid());

-- ENDURECIMIENTO (defensa en profundidad, además de RLS):
-- el navegador (PostgREST con anon/authenticated) NO escribe gamificación,
-- progreso ni intentos — esas escrituras solo viven en el servidor (Drizzle).
-- Y el answer key de los quizzes (correct_answer) jamás sale por PostgREST.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, avatar_url, locale, onboarding_completed) on public.profiles to authenticated;
revoke insert, update, delete on public.progress from anon, authenticated;
revoke insert, update, delete on public.quiz_attempts from anon, authenticated;
revoke all on public.questions from anon, authenticated;
grant select (id, quiz_id, order_index, type, prompt, options, explanation, created_at) on public.questions to authenticated;
revoke truncate, trigger on public.profiles, public.progress, public.quiz_attempts,
  public.questions, public.xp_events, public.achievements, public.user_achievements
  from anon, authenticated;

-- gamificación: el dueño lee lo suyo; las escrituras las hace el servidor
drop policy if exists "xp_events_read_owner" on public.xp_events;
create policy "xp_events_read_owner" on public.xp_events
  for select using (user_id = auth.uid());

drop policy if exists "achievements_read_all" on public.achievements;
create policy "achievements_read_all" on public.achievements
  for select using (auth.role() = 'authenticated');

drop policy if exists "user_achievements_read_owner" on public.user_achievements;
create policy "user_achievements_read_owner" on public.user_achievements
  for select using (user_id = auth.uid());

-- 4) Realtime: publicar learning_paths para que el progreso de generación
--    llegue al navegador en vivo (postgres_changes). Idempotente.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'learning_paths'
  ) then
    alter publication supabase_realtime add table public.learning_paths;
  end if;
end $$;

-- clases en vivo: dueño lee lo suyo; route_agents solo servidor (canónico)
alter table public.route_agents     enable row level security;
alter table public.live_sessions    enable row level security;
alter table public.homework_items   enable row level security;
alter table public.learner_profiles enable row level security;
drop policy if exists "live_sessions_read_owner" on public.live_sessions;
create policy "live_sessions_read_owner" on public.live_sessions
  for select using (user_id = auth.uid());
drop policy if exists "homework_read_owner" on public.homework_items;
create policy "homework_read_owner" on public.homework_items
  for select using (user_id = auth.uid());
drop policy if exists "learner_profiles_read_owner" on public.learner_profiles;
create policy "learner_profiles_read_owner" on public.learner_profiles
  for select using (user_id = auth.uid());
revoke insert, update, delete, truncate, trigger on public.route_agents,
  public.live_sessions, public.homework_items, public.learner_profiles
  from anon, authenticated;
