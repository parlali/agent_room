CREATE TABLE `app_github_apps` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`app_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret_secret_id` text NOT NULL,
	`private_key_secret_id` text NOT NULL,
	`webhook_secret_secret_id` text,
	`html_url` text,
	`status` text DEFAULT 'ready' NOT NULL,
	`validation_message` text,
	`last_validated_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`client_secret_secret_id`) REFERENCES `secrets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`private_key_secret_id`) REFERENCES `secrets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`webhook_secret_secret_id`) REFERENCES `secrets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "app_github_apps_singleton_check" CHECK("app_github_apps"."id" = 1),
	CONSTRAINT "app_github_apps_status_check" CHECK("app_github_apps"."status" IN ('unchecked', 'ready', 'invalid'))
);
--> statement-breakpoint
CREATE TABLE `app_github_installations` (
	`installation_id` text PRIMARY KEY NOT NULL,
	`account_login` text NOT NULL,
	`account_type` text NOT NULL,
	`target_type` text,
	`html_url` text,
	`repository_selection` text DEFAULT 'selected' NOT NULL,
	`permissions` text DEFAULT '{}' NOT NULL,
	`suspended_at` integer,
	`status` text DEFAULT 'ready' NOT NULL,
	`last_synced_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "app_github_installations_status_check" CHECK("app_github_installations"."status" IN ('unchecked', 'ready', 'invalid'))
);
--> statement-breakpoint
CREATE INDEX `app_github_installations_account_idx` ON `app_github_installations` (`account_login`);--> statement-breakpoint
CREATE TABLE `app_github_manifest_sessions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`public_origin` text NOT NULL,
	`target_owner` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "app_github_manifest_sessions_status_check" CHECK("app_github_manifest_sessions"."status" IN ('pending', 'completed', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `app_github_manifest_sessions_expires_at_idx` ON `app_github_manifest_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `app_github_user_auth_sessions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`public_origin` text NOT NULL,
	`code_verifier` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "app_github_user_auth_sessions_status_check" CHECK("app_github_user_auth_sessions"."status" IN ('pending', 'completed', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `app_github_user_auth_sessions_expires_at_idx` ON `app_github_user_auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `app_github_user_connections` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`github_user_id` text NOT NULL,
	`login` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`html_url` text,
	`token_type` text DEFAULT 'bearer' NOT NULL,
	`access_token_secret_id` text NOT NULL,
	`access_token_expires_at` integer,
	`refresh_token_secret_id` text,
	`refresh_token_expires_at` integer,
	`created_by_user_id` text,
	`last_authorized_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`access_token_secret_id`) REFERENCES `secrets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`refresh_token_secret_id`) REFERENCES `secrets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "app_github_user_connections_singleton_check" CHECK("app_github_user_connections"."id" = 1)
);
--> statement-breakpoint
CREATE INDEX `app_github_user_connections_login_idx` ON `app_github_user_connections` (`login`);--> statement-breakpoint
CREATE TABLE `app_mcp_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`server_key` text NOT NULL,
	`transport` text NOT NULL,
	`command` text,
	`args` text DEFAULT '[]' NOT NULL,
	`url` text,
	`headers` text DEFAULT '{}' NOT NULL,
	`auth_mode` text DEFAULT 'none' NOT NULL,
	`credential_secret_id` text,
	`allowed_tools` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'unchecked' NOT NULL,
	`validation_message` text,
	`last_validated_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`credential_secret_id`) REFERENCES `secrets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "app_mcp_connections_transport_check" CHECK("app_mcp_connections"."transport" IN ('stdio', 'http', 'streamable_http')),
	CONSTRAINT "app_mcp_connections_auth_mode_check" CHECK("app_mcp_connections"."auth_mode" IN ('none', 'bearer')),
	CONSTRAINT "app_mcp_connections_status_check" CHECK("app_mcp_connections"."status" IN ('unchecked', 'ready', 'invalid')),
	CONSTRAINT "app_mcp_connections_endpoint_check" CHECK((
                (
                    "app_mcp_connections"."transport" = 'stdio'
                    AND "app_mcp_connections"."command" IS NOT NULL
                    AND length(trim("app_mcp_connections"."command")) > 0
                )
                OR (
                    "app_mcp_connections"."transport" IN ('http', 'streamable_http')
                    AND "app_mcp_connections"."url" IS NOT NULL
                    AND length(trim("app_mcp_connections"."url")) > 0
                )
            ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_mcp_connections_server_key_unique` ON `app_mcp_connections` (`server_key`);--> statement-breakpoint
CREATE INDEX `app_mcp_connections_transport_idx` ON `app_mcp_connections` (`transport`);--> statement-breakpoint
CREATE TABLE `app_provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`provider` text NOT NULL,
	`auth_mode` text NOT NULL,
	`api` text NOT NULL,
	`base_url` text,
	`default_model` text NOT NULL,
	`fallback_models` text DEFAULT '[]' NOT NULL,
	`credential_secret_id` text,
	`status` text DEFAULT 'unchecked' NOT NULL,
	`validation_message` text,
	`last_validated_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`credential_secret_id`) REFERENCES `secrets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "app_provider_connections_provider_check" CHECK("app_provider_connections"."provider" IN ('openrouter', 'openai-codex')),
	CONSTRAINT "app_provider_connections_auth_mode_check" CHECK("app_provider_connections"."auth_mode" IN ('api_key', 'oauth')),
	CONSTRAINT "app_provider_connections_api_check" CHECK("app_provider_connections"."api" IN ('openai-completions', 'openai-codex-responses')),
	CONSTRAINT "app_provider_connections_status_check" CHECK("app_provider_connections"."status" IN ('unchecked', 'ready', 'invalid')),
	CONSTRAINT "app_provider_connections_auth_secret_check" CHECK((
                (
                    "app_provider_connections"."provider" = 'openrouter'
                    AND "app_provider_connections"."auth_mode" = 'api_key'
                    AND "app_provider_connections"."api" = 'openai-completions'
                    AND "app_provider_connections"."credential_secret_id" IS NOT NULL
                )
                OR (
                    "app_provider_connections"."provider" = 'openai-codex'
                    AND "app_provider_connections"."auth_mode" = 'oauth'
                    AND "app_provider_connections"."api" = 'openai-codex-responses'
                    AND "app_provider_connections"."credential_secret_id" IS NULL
                )
            ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_provider_connections_provider_unique_idx` ON `app_provider_connections` (`provider`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`default_provider_connection_id` text,
	`default_model` text,
	`capability_defaults` text DEFAULT '{}' NOT NULL,
	`search_config` text DEFAULT '{}' NOT NULL,
	`image_config` text DEFAULT '{}' NOT NULL,
	`onboarding_completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`default_provider_connection_id`) REFERENCES `app_provider_connections`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "app_settings_singleton_check" CHECK("app_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `artifact_index` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`kind` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_length` integer NOT NULL,
	`media_type` text NOT NULL,
	`manifest_path` text NOT NULL,
	`source` text DEFAULT '{}' NOT NULL,
	`provenance` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "artifact_index_kind_check" CHECK("artifact_index"."kind" IN ('attachment', 'artifact'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_index_room_artifact_unique` ON `artifact_index` (`room_id`,`artifact_id`);--> statement-breakpoint
CREATE INDEX `artifact_index_room_id_idx` ON `artifact_index` (`room_id`);--> statement-breakpoint
CREATE INDEX `artifact_index_sha_idx` ON `artifact_index` (`sha256`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` text,
	`room_id` text,
	`action` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_events_room_id_idx` ON `audit_events` (`room_id`);--> statement-breakpoint
CREATE INDEX `audit_events_action_idx` ON `audit_events` (`action`);--> statement-breakpoint
CREATE TABLE `provider_validation_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_connection_id` text,
	`room_id` text,
	`provider` text NOT NULL,
	`auth_mode` text NOT NULL,
	`api` text NOT NULL,
	`base_url` text,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	FOREIGN KEY (`provider_connection_id`) REFERENCES `app_provider_connections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "provider_validation_attempts_auth_mode_check" CHECK("provider_validation_attempts"."auth_mode" IN ('api_key', 'oauth')),
	CONSTRAINT "provider_validation_attempts_api_check" CHECK("provider_validation_attempts"."api" IN ('openai-completions', 'openai-codex-responses')),
	CONSTRAINT "provider_validation_attempts_status_check" CHECK("provider_validation_attempts"."status" IN ('unchecked', 'ready', 'invalid'))
);
--> statement-breakpoint
CREATE INDEX `provider_validation_attempts_provider_idx` ON `provider_validation_attempts` (`provider`,`completed_at`);--> statement-breakpoint
CREATE TABLE `room_configs` (
	`room_id` text PRIMARY KEY NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`provider_mode` text DEFAULT 'app_default' NOT NULL,
	`provider_connection_id` text,
	`room_mode` text DEFAULT 'coworker' NOT NULL,
	`capability_overrides` text DEFAULT '{}' NOT NULL,
	`image_provider` text,
	`image_model` text,
	`image_secret_id` text,
	`cron_timezone` text DEFAULT 'UTC' NOT NULL,
	`browser_action_budget` integer DEFAULT 50 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_connection_id`) REFERENCES `app_provider_connections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`image_secret_id`) REFERENCES `secrets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "room_configs_provider_mode_check" CHECK("room_configs"."provider_mode" IN ('app_default', 'app_connection', 'managed_hosted')),
	CONSTRAINT "room_configs_room_mode_check" CHECK("room_configs"."room_mode" IN ('programmer', 'coworker')),
	CONSTRAINT "room_configs_image_provider_check" CHECK("room_configs"."image_provider" IS NULL OR "room_configs"."image_provider" IN ('openai', 'gemini')),
	CONSTRAINT "room_configs_browser_action_budget_check" CHECK("room_configs"."browser_action_budget" BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX `room_configs_provider_connection_idx` ON `room_configs` (`provider_connection_id`);--> statement-breakpoint
CREATE TABLE `room_cron_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`every_minutes` integer NOT NULL,
	`schedule` text DEFAULT '{"type":"daily","times":["09:00"]}' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`session_target` text DEFAULT 'isolated' NOT NULL,
	`target_thread_key` text,
	`next_run_at` integer,
	`running_at` integer,
	`locked_until` integer,
	`lock_token` text,
	`heartbeat_at` integer,
	`last_renewed_at` integer,
	`run_budget_ms` integer,
	`recovery_reason` text,
	`last_run_at` integer,
	`last_run_status` text,
	`last_error` text,
	`last_duration_ms` integer,
	`provider` text,
	`model` text,
	`config_version` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "room_cron_jobs_every_minutes_check" CHECK("room_cron_jobs"."every_minutes" > 0),
	CONSTRAINT "room_cron_jobs_session_target_check" CHECK("room_cron_jobs"."session_target" IN ('isolated', 'selected'))
);
--> statement-breakpoint
CREATE INDEX `room_cron_jobs_room_id_idx` ON `room_cron_jobs` (`room_id`);--> statement-breakpoint
CREATE INDEX `room_cron_jobs_due_idx` ON `room_cron_jobs` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `room_cron_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`job_id` text,
	`job_name` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`error` text,
	`session_key` text,
	`session_id` text,
	`provider` text,
	`model` text,
	`config_version` integer,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`next_run_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `room_cron_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "room_cron_runs_attempt_check" CHECK("room_cron_runs"."attempt" > 0),
	CONSTRAINT "room_cron_runs_status_check" CHECK("room_cron_runs"."status" IN ('running', 'complete', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX `room_cron_runs_room_id_started_at_idx` ON `room_cron_runs` (`room_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `room_cron_runs_job_id_started_at_idx` ON `room_cron_runs` (`job_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `room_github_bindings` (
	`room_id` text PRIMARY KEY NOT NULL,
	`installation_id` text NOT NULL,
	`repositories` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installation_id`) REFERENCES `app_github_installations`(`installation_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `room_github_bindings_installation_idx` ON `room_github_bindings` (`installation_id`);--> statement-breakpoint
CREATE TABLE `room_mcp_bindings` (
	`room_id` text NOT NULL,
	`mcp_connection_id` text NOT NULL,
	`allowed_tools` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`room_id`, `mcp_connection_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mcp_connection_id`) REFERENCES `app_mcp_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `room_mcp_bindings_connection_idx` ON `room_mcp_bindings` (`mcp_connection_id`);--> statement-breakpoint
CREATE TABLE `room_onboarding` (
	`room_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`session_key` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`deferred_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "room_onboarding_status_check" CHECK("room_onboarding"."status" IN ('pending', 'completed', 'user_deferred'))
);
--> statement-breakpoint
CREATE INDEX `room_onboarding_status_idx` ON `room_onboarding` (`status`);--> statement-breakpoint
CREATE TABLE `room_runtime_metadata` (
	`room_id` text PRIMARY KEY NOT NULL,
	`port` integer,
	`pid` integer,
	`sandbox_uid` integer,
	`sandbox_gid` integer,
	`sandbox_user_name` text,
	`sandbox_group_name` text,
	`config_version` integer DEFAULT 1 NOT NULL,
	`token_version` integer DEFAULT 1 NOT NULL,
	`health_status` text DEFAULT 'unknown' NOT NULL,
	`started_at` integer,
	`last_health_at` integer,
	`last_error` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "room_runtime_metadata_health_status_check" CHECK("room_runtime_metadata"."health_status" IN ('unknown', 'healthy', 'unhealthy'))
);
--> statement-breakpoint
CREATE TABLE `room_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`secret_id` text NOT NULL,
	`label` text NOT NULL,
	`env_key` text NOT NULL,
	`purpose` text NOT NULL,
	`provider` text,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`secret_id`) REFERENCES `secrets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "room_secrets_purpose_check" CHECK("room_secrets"."purpose" IN ('generic', 'webhook', 'image_api_key'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_secrets_room_env_unique` ON `room_secrets` (`room_id`,`env_key`);--> statement-breakpoint
CREATE INDEX `room_secrets_room_id_idx` ON `room_secrets` (`room_id`);--> statement-breakpoint
CREATE TABLE `room_session_badge_state` (
	`user_id` text NOT NULL,
	`room_id` text NOT NULL,
	`session_key` text NOT NULL,
	`completed_cleared_at` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `room_id`, `session_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `room_session_badge_state_room_user_idx` ON `room_session_badge_state` (`room_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text NOT NULL,
	`desired_state` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rooms_status_check" CHECK("rooms"."status" IN ('starting', 'running', 'stopped', 'degraded', 'failed', 'setup_required')),
	CONSTRAINT "rooms_desired_state_check" CHECK("rooms"."desired_state" IN ('running', 'stopped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_slug_unique` ON `rooms` (`slug`);--> statement-breakpoint
CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`key_name` text NOT NULL,
	`cipher_text` blob NOT NULL,
	`nonce` blob NOT NULL,
	`auth_tag` blob NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secrets_key_name_unique` ON `secrets` (`key_name`);--> statement-breakpoint
CREATE TABLE `session_composer_drafts` (
	`auth_session_id` text NOT NULL,
	`room_id` text NOT NULL,
	`session_key` text NOT NULL,
	`draft` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`auth_session_id`, `room_id`, `session_key`),
	FOREIGN KEY (`auth_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_composer_drafts_length_check" CHECK(length("session_composer_drafts"."draft") <= 20000)
);
--> statement-breakpoint
CREATE INDEX `session_composer_drafts_room_session_idx` ON `session_composer_drafts` (`room_id`,`session_key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer,
	`user_agent` text,
	`ip_address` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text,
	`session_key` text,
	`run_id` text,
	`job_id` text,
	`kind` text NOT NULL,
	`provider` text,
	`model` text,
	`tool_name` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cached_tokens` integer,
	`reasoning_tokens` integer,
	`total_tokens` integer,
	`duration_ms` integer,
	`active_duration_ms` integer,
	`idle_duration_ms` integer,
	`estimated_cost_usd` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `room_cron_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "usage_events_kind_check" CHECK("usage_events"."kind" IN ('run', 'provider', 'tool', 'document_worker', 'image', 'job'))
);
--> statement-breakpoint
CREATE INDEX `usage_events_room_created_idx` ON `usage_events` (`room_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_events_kind_created_idx` ON `usage_events` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_events_session_run_idx` ON `usage_events` (`room_id`,`session_key`,`run_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('root', 'operator'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
