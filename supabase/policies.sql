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
  insert into public.profiles (id, full_name, avatar_url, locale)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_user_meta_data->>'preferred_language', 'es')
  )
  on conflict (id) do nothing;

  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active')
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
