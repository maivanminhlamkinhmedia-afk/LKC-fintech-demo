-- Enforce one team per user; no membership or customer rows are rewritten.
CREATE UNIQUE INDEX `SalesTeamMember_userId_key` ON `SalesTeamMember`(`userId`);
