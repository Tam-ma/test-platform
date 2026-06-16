CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`domain` text,
	`email` text,
	`website` text,
	`status` text DEFAULT 'active' NOT NULL,
	`subscription_tier` text DEFAULT 'free' NOT NULL,
	`is_personal` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `user_organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`invitation_token` text,
	`invited_by` text,
	`job_title` text,
	`department` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_organizations_invitation_token_unique` ON `user_organizations` (`invitation_token`);--> statement-breakpoint
ALTER TABLE `api_keys` ADD `organization_id` text REFERENCES organizations(id);--> statement-breakpoint
ALTER TABLE `model_usage` ADD `organization_id` text REFERENCES organizations(id);--> statement-breakpoint
ALTER TABLE `user_model_configs` ADD `organization_id` text REFERENCES organizations(id);--> statement-breakpoint
ALTER TABLE `users` ADD `system_role` text;