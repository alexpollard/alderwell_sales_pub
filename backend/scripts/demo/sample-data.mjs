// Sample records shown to demo visitors. Dates are worked out from today on every
// reset, so campaigns stay current and follow-ups stay upcoming.
//
// Every sample row uses an id starting with SAMPLE_ID_PREFIX. The snapshot script
// skips those rows so only your real data is saved, and the reset re-creates them.

export const SAMPLE_ID_PREFIX = 'dec0de00-';
const id = (n) => `${SAMPLE_ID_PREFIX}0000-4000-8000-${String(n).padStart(12, '0')}`;

function day(offsetDays) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
const at = (offsetDays, hour = 10) => `${day(offsetDays)}T${String(hour).padStart(2, '0')}:00:00+00:00`;

// users: { manager, marketing, sales } -> auth user ids
export function buildSampleData(users) {
  const { manager, marketing, sales } = users;

  const campaigns = [
    { campaign_id: id(101), campaign_name: 'Cardiovex Spring Launch', campaign_status: 'active', created_by: manager,
      campaign_description: 'Launch of Cardiovex 10mg to GP surgeries and cardiology clinics across the North West region.',
      campaign_start_date: day(-30), campaign_end_date: day(60), created_at: at(-35) },
    { campaign_id: id(102), campaign_name: 'Respira GP Outreach', campaign_status: 'active', created_by: manager,
      campaign_description: 'Raise awareness of the Respira inhaler with practice nurses and asthma clinics.',
      campaign_start_date: day(-10), campaign_end_date: day(80), created_at: at(-14) },
    { campaign_id: id(103), campaign_name: 'Dermacalm Clinic Samples', campaign_status: 'pending_approval', created_by: marketing,
      campaign_description: 'Sample packs of Dermacalm cream for dermatology clinics. Awaiting manager approval.',
      campaign_start_date: day(14), campaign_end_date: day(90), created_at: at(-3) },
    { campaign_id: id(104), campaign_name: 'Winter Flu Awareness', campaign_status: 'draft', created_by: marketing,
      campaign_description: 'Draft plan for pharmacy posters and patient leaflets ahead of flu season.',
      campaign_start_date: day(45), campaign_end_date: day(120), created_at: at(-1) },
    { campaign_id: id(105), campaign_name: 'Hospital Formulary Push', campaign_status: 'archived', created_by: manager,
      campaign_description: 'Completed campaign to get Cardiovex onto three regional hospital formularies.',
      campaign_start_date: day(-150), campaign_end_date: day(-60), created_at: at(-155) },
  ];

  const campaign_assignees = [
    { campaign_id: id(101), user_id: marketing },
    { campaign_id: id(101), user_id: sales },
    { campaign_id: id(102), user_id: sales },
    { campaign_id: id(103), user_id: marketing },
  ];

  const tasks = [
    { task_id: id(201), task_name: 'Prepare Cardiovex launch slide deck', task_status: 'in_progress', created_by: manager,
      task_description: 'Slides for the regional launch event: product overview, dosing and patient case studies.',
      assigned_role: 'marketing_team_member', assigned_user_id: marketing, taken_by: marketing, created_at: at(-6) },
    { task_id: id(202), task_name: 'Book stand at regional cardiology conference', task_status: 'pending', created_by: manager,
      task_description: 'Reserve a stand and order banners for the conference next month.',
      assigned_role: 'marketing_team_member', is_urgent: true, created_at: at(-2) },
    { task_id: id(203), task_name: 'Follow up on Dr Patel sample request', task_status: 'pending', created_by: manager,
      task_description: 'Dr Patel asked for Cardiovex samples at last week\'s meeting.',
      assigned_role: 'sales_representative', assigned_user_id: sales, created_at: at(-4) },
    { task_id: id(204), task_name: 'Compliance review of Respira leaflet', task_status: 'blocked', created_by: marketing,
      task_description: 'Check the new patient leaflet against current prescribing information.',
      assigned_role: 'compliance_officer', created_at: at(-8) },
    { task_id: id(205), task_name: 'Update territory sales targets', task_status: 'done', created_by: manager,
      task_description: 'Set next quarter\'s targets for each sales territory.',
      assigned_role: 'manager', assigned_user_id: manager, taken_by: manager, created_at: at(-12) },
    { task_id: id(206), task_name: 'Collate monthly sales activity report', task_status: 'pending', created_by: manager,
      task_description: 'Summarise meetings, calls and orders from the last month.',
      assigned_role: 'sales_representative', created_at: at(-1) },
  ].map((t) => ({ is_urgent: false, assigned_user_id: null, taken_by: null, ...t, updated_at: t.created_at }));

  const task_notes = [
    { note_id: id(301), task_id: id(201), created_by: marketing, created_at: at(-4),
      note_text: 'First draft done. Waiting on updated efficacy chart from the medical team.' },
    { note_id: id(302), task_id: id(204), created_by: marketing, created_at: at(-5),
      note_text: 'Blocked: the medical team is still updating the prescribing information.' },
  ];

  const interactions = [
    { n: 401, hcp: 'Dr Amelia Patel, Riverside Surgery', type: 'meeting', d: -7, campaign: 101, order: [2400, 200, 'Cardiovex 10mg'],
      notes: 'Positive response to the launch data. Requested samples for two partners.' },
    { n: 402, hcp: 'Dr Tom Reid, Northgate Medical Centre', type: 'call', d: -5, campaign: 101,
      notes: 'Interested but wants to see the full trial results first.' },
    { n: 403, hcp: 'Sarah Lowe, Practice Nurse, Elm Tree Practice', type: 'meeting', d: -4, campaign: 102, order: [960, 80, 'Respira Inhaler'],
      notes: 'Ordered for the asthma clinic. Asked for patient technique leaflets.' },
    { n: 404, hcp: 'Dr Hannah Brooks, St Mary\'s Hospital', type: 'conference', d: -15, campaign: 101,
      notes: 'Met at the cardiology conference. Will raise Cardiovex at the next formulary meeting.' },
    { n: 405, hcp: 'Dr Kwame Mensah, Parkside Health', type: 'email', d: -3, campaign: 102,
      notes: 'Sent Respira product information pack.' },
    { n: 406, hcp: 'Dr Lucy Chen, Westfield Surgery', type: 'meeting', d: -20, order: [1800, 150, 'Cardiovex 10mg'],
      notes: 'Repeat order after a successful three-month trial.' },
    { n: 407, hcp: 'Mark Ellis, Pharmacist, Ellis Pharmacy', type: 'call', d: -2, order: [450, 60, 'Dermacalm Cream'],
      notes: 'Stock order for the pharmacy counter.' },
    { n: 408, hcp: 'Dr Grace Owen, Hillview Practice', type: 'other', d: -9,
      notes: 'Dropped in samples. Doctor was busy, so this needs a follow-up.' },
  ].map((i) => ({
    interaction_id: id(i.n), employee_id: sales, hcp_name: i.hcp, interaction_type: i.type,
    interaction_date: day(i.d), notes: i.notes, campaign_id: i.campaign ? id(i.campaign) : null,
    did_convert: Boolean(i.order), conversion_value: i.order ? i.order[0] : null,
    quantity: i.order ? i.order[1] : null, product_name: i.order ? i.order[2] : null,
    is_archived: false, created_at: at(i.d, 15), updated_at: at(i.d, 15),
  }));

  const follow_ups = [
    { n: 501, interaction: 401, outcome: 'Check-in', d: 3, done: false, next: 'Check the samples arrived and ask about first patient feedback.' },
    { n: 502, interaction: 402, outcome: 'Continue discussions', d: 2, done: false, next: 'Send full trial summary and book a follow-up call.' },
    { n: 503, interaction: 403, outcome: 'Check-in', d: 10, done: false, next: 'Drop off patient technique leaflets.' },
    { n: 504, interaction: 404, outcome: 'Continue discussions', d: 14, done: false, next: 'Ask for the outcome of the formulary meeting.' },
    { n: 505, interaction: 408, outcome: 'Continue discussions', d: -1, done: false, next: 'Revisit Hillview Practice to discuss the samples.' },
    { n: 506, interaction: 406, outcome: 'Check-in', d: -10, done: true, next: 'Confirmed delivery and that patients are getting on well.' },
  ].map((f) => ({
    follow_up_id: id(f.n), interaction_id: id(f.interaction), employee_id: sales, outcome: f.outcome,
    next_steps: f.next, follow_up_date: day(f.d), is_completed: f.done,
  }));

  return { campaigns, campaign_assignees, tasks, task_notes, interactions, follow_ups };
}
