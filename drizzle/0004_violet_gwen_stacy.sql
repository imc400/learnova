CREATE INDEX "progress_lesson_idx" ON "progress" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "progress_path_user_idx" ON "progress" USING btree ("path_id","user_id");--> statement-breakpoint
CREATE INDEX "quiz_attempts_user_idx" ON "quiz_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "quiz_attempts_quiz_idx" ON "quiz_attempts" USING btree ("quiz_id");--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;--> statement-breakpoint
GRANT UPDATE (full_name, avatar_url, locale, onboarding_completed) ON public.profiles TO authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.progress FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.quiz_attempts FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON public.questions FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT (id, quiz_id, order_index, type, prompt, options, explanation, created_at) ON public.questions TO authenticated;