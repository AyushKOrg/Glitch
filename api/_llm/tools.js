// Tool declarations shared by both Gemini and OpenRouter.
const TOOLS = [
  {
    name: 'web_search',
    description: 'Search Google for information whenever external facts, context, verification, recommendations, or current details would improve the answer. Returns a concise summary and source URLs.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look up' } },
      required: ['query'],
    },
  },

  {name:'google_drive_search',description:'Search the connected user’s Google Drive files by name (read-only).',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'gmail_search',description:'Search the connected user’s Gmail messages and return sender, subject and snippets (read-only).',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'google_calendar_upcoming',description:'Read upcoming primary Google Calendar events.',parameters:{type:'object',properties:{max_results:{type:'integer'}}}},
  {name:'google_doc_read',description:'Read a Google Doc by ID.',parameters:{type:'object',properties:{document_id:{type:'string'}},required:['document_id']}},
  {name:'google_sheet_read',description:'Read a Google Sheets range by spreadsheet ID.',parameters:{type:'object',properties:{spreadsheet_id:{type:'string'},range:{type:'string'}},required:['spreadsheet_id']}},
  {name:'google_form_read',description:'Read a Google Form structure and questions by form ID (read-only).',parameters:{type:'object',properties:{form_id:{type:'string'}},required:['form_id']}},
  {name:'google_form_responses',description:'Read recent responses to a Google Form by form ID (read-only; only when the connected account has permission).',parameters:{type:'object',properties:{form_id:{type:'string'},page_size:{type:'integer'}},required:['form_id']}},
  {name:'google_slides_read',description:'Read slide text from a Google Slides presentation by presentation ID (read-only).',parameters:{type:'object',properties:{presentation_id:{type:'string'}},required:['presentation_id']}},

  {name:'google_drive_download_text',description:'Read text content from a Drive file by ID.',parameters:{type:'object',properties:{file_id:{type:'string'}},required:['file_id']}},
  {name:'google_drive_upload_text',description:'Create a text file in Drive from supplied content.',parameters:{type:'object',properties:{name:{type:'string'},mime_type:{type:'string'},content:{type:'string'},parent_id:{type:'string'}},required:['name','content']}},
  {name:'google_drive_trash',description:'Move a Drive file to trash only when the user explicitly asks.',parameters:{type:'object',properties:{file_id:{type:'string'}},required:['file_id']}},
  {name:'gmail_create_draft',description:'Create a Gmail draft without sending it.',parameters:{type:'object',properties:{to:{type:'string'},subject:{type:'string'},body:{type:'string'}},required:['to','subject','body']}},
  {name:'google_calendar_delete',description:'Delete a calendar event only when the user explicitly asks.',parameters:{type:'object',properties:{event_id:{type:'string'}},required:['event_id']}},
  {name:'google_drive_create',description:'Create a Drive file or blank Google Workspace document when explicitly requested.',parameters:{type:'object',properties:{name:{type:'string'},mime_type:{type:'string'},parent_id:{type:'string'}},required:['name'] }},
  {name:'google_drive_update',description:'Rename a Drive file when explicitly requested.',parameters:{type:'object',properties:{file_id:{type:'string'},name:{type:'string'}},required:['file_id','name']}},
  {name:'google_doc_create',description:'Create a Google Doc with optional initial text.',parameters:{type:'object',properties:{title:{type:'string'},text:{type:'string'}}}},
  {name:'google_doc_append',description:'Append text to a Google Doc.',parameters:{type:'object',properties:{document_id:{type:'string'},text:{type:'string'}},required:['document_id','text']}},
  {name:'google_sheet_update',description:'Write values to a Google Sheets range.',parameters:{type:'object',properties:{spreadsheet_id:{type:'string'},range:{type:'string'},values:{type:'array',items:{type:'array',items:{type:'string'}}}},required:['spreadsheet_id','range','values']}},
  {name:'google_calendar_create',description:'Create a Google Calendar event.',parameters:{type:'object',properties:{summary:{type:'string'},description:{type:'string'},location:{type:'string'},start:{type:'object'},end:{type:'object'}},required:['summary','start','end']}},
  {name:'google_calendar_update',description:'Update a Google Calendar event.',parameters:{type:'object',properties:{event_id:{type:'string'},summary:{type:'string'},description:{type:'string'},location:{type:'string'},start:{type:'object'},end:{type:'object'}},required:['event_id']}},
  {name:'gmail_send',description:'Send email only when directly instructed by the user.',parameters:{type:'object',properties:{to:{type:'string'},subject:{type:'string'},body:{type:'string'}},required:['to','subject','body']}},
  {name:'google_slides_batch_update',description:'Update a Google Slides presentation using API batch requests.',parameters:{type:'object',properties:{presentation_id:{type:'string'},requests:{type:'array',items:{type:'object',properties:{}}}},required:['presentation_id','requests']}},
  {name:'google_forms_batch_update',description:'Update a Google Form using API batch requests.',parameters:{type:'object',properties:{form_id:{type:'string'},requests:{type:'array',items:{type:'object',properties:{}}}},required:['form_id','requests']}},
  {name:'weather_current',description:'Get current conditions and forecast using the free Open-Meteo weather service.',parameters:{type:'object',properties:{location:{type:'string'},days:{type:'integer'}},required:['location']}},
];

module.exports = { TOOLS };
