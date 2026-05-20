import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function textPrompt(description: string, text: string) {
  return {
    description,
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text },
      },
    ],
  };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'weekly_account_audit',
    {
      title: 'Weekly Meta Ads account audit',
      description:
        'Run a disciplined weekly audit for one account: spend, waste, recommendations, policy risks and next actions.',
      argsSchema: {
        accountId: z.string().describe('Internal account id from accounts.json.'),
        datePreset: z.string().default('last_7d'),
        requestedBy: z.string().optional(),
      },
    },
    async ({ accountId, datePreset, requestedBy }) =>
      textPrompt(
        'Weekly Meta Ads account audit workflow.',
        [
          `Run a weekly Meta Ads audit for account \`${accountId}\` using datePreset \`${datePreset}\`.`,
          requestedBy ? `Operator/requestedBy: ${requestedBy}.` : undefined,
          '',
          'Follow this exact sequence:',
          '1. Read `meta-ads://accounts/config-summary` and confirm the effective safety posture.',
          '2. Call `list_campaigns` for the account and summarize active/paused/rejected campaigns.',
          '3. Call `generate_performance_report` for the account/date preset.',
          '4. Call `find_wasted_spend` and separate true waste from learning-phase noise.',
          '5. For the worst 3 campaigns, call `recommend_campaign_optimizations`.',
          '6. Call `validate_meta_policy_risk` for any recommendation involving targeting or copy changes.',
          '7. Read `meta-ads://audit/account/' + encodeURIComponent(accountId) + '` and include recent mutations/rejections.',
          '',
          'Output format:',
          '- Executive summary (5 bullets max).',
          '- Account safety state (`READ_ONLY`, `DRY_RUN`, account mode, caps).',
          '- KPI table: spend, impressions, clicks, CTR, CPC, CPM, conversions, CPA, ROAS, frequency.',
          '- Waste findings with evidence.',
          '- Recommendations split into: safe read-only, needs dry-run, needs human approval.',
          '- Never promise results. Use heuristic language only.',
          '- Do not call any mutating tool unless the user explicitly approves a specific plan.',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
  );

  server.registerPrompt(
    'campaign_launch_plan',
    {
      title: 'Safe campaign launch plan',
      description:
        'Create a compliant launch plan before drafting/publishing a Meta campaign. Does not mutate unless the operator later approves.',
      argsSchema: {
        accountId: z.string(),
        campaignName: z.string(),
        objective: z.string(),
        dailyBudget: z.string().describe('Budget in account currency, major units.'),
        offer: z.string().describe('Product/offer being promoted.'),
        specialAdCategory: z.string().default('NONE'),
        requestedBy: z.string().optional(),
      },
    },
    async ({
      accountId,
      campaignName,
      objective,
      dailyBudget,
      offer,
      specialAdCategory,
      requestedBy,
    }) =>
      textPrompt(
        'Safe Meta campaign launch planning workflow.',
        [
          `Prepare a safe launch plan for campaign \`${campaignName}\` in account \`${accountId}\`.`,
          `Objective: ${objective}. Daily budget: ${dailyBudget}. Offer: ${offer}. Special Ad Category: ${specialAdCategory}.`,
          requestedBy ? `Operator/requestedBy: ${requestedBy}.` : undefined,
          '',
          'Workflow:',
          '1. Read `meta-ads://accounts/config-summary` and locate the account caps/mode.',
          '2. Call `adjust_budget_recommendation` using the proposed daily budget and current account/global caps.',
          '3. Build a targeting plan with `recommend_audience_strategy`.',
          '4. For every interest/location/language placeholder, call `search_targeting_ids` before creating drafts.',
          '5. Call `validate_meta_policy_risk` for copy + targeting + Special Ad Category.',
          '6. If safe, call `create_campaign_draft`, `create_ad_set_draft` and `create_ad_creative_draft` only as local drafts.',
          '7. Read `meta-ads://drafts/account/' + encodeURIComponent(accountId) + '` and summarize the created drafts.',
          '',
          'Do NOT call `publish_campaign` unless the user explicitly approves a final plan with confirm=true, reason, requestedBy and dryRun=false. New campaigns must remain PAUSED.',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
  );

  server.registerPrompt(
    'creative_review_playbook',
    {
      title: 'Creative review playbook',
      description:
        'Review an ad creative for clarity, likely audience fit, policy risk and A/B testing plan.',
      argsSchema: {
        accountId: z.string(),
        productOrOffer: z.string(),
        landingPageUrl: z.string().optional(),
        imageDescription: z.string().optional(),
      },
    },
    async ({ accountId, productOrOffer, landingPageUrl, imageDescription }) =>
      textPrompt(
        'Meta Ads creative review workflow.',
        [
          `Review ad creative for account \`${accountId}\`.`,
          `Product/offer: ${productOrOffer}.`,
          landingPageUrl ? `Landing page: ${landingPageUrl}.` : undefined,
          imageDescription ? `Image/video description: ${imageDescription}.` : undefined,
          '',
          'Ask the operator for headline, primary text and CTA if missing, then:',
          '1. Call `analyze_ad_creative` with the provided copy and asset description.',
          '2. Call `predict_best_audience_for_ad` for audience fit and exclusions.',
          '3. Call `validate_meta_policy_risk` for copy and targeting implications.',
          '4. Call `recommend_ab_tests` with exactly one variable per proposed test.',
          '',
          'Output:',
          '- Clarity and hook assessment.',
          '- Policy risks and required edits.',
          '- Best-fit audience hypothesis.',
          '- A/B plan with one variable per test.',
          '- D+3 / D+7 / D+14 review plan.',
          '- No guarantees or promised performance outcomes.',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
  );
}
