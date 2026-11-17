// Conversation-context panel and its open/close interactions.
(function () {
  function initContextPanel({ $, getHistory, getMemoryCount, getUser, loadMemories }) {
  function refreshContextPanel(){const list=$('contextList'),summary=$('contextSummary');if(!list||!summary)return;const rows=getHistory().slice(-40);summary.textContent=rows.length+' messages in this conversation are available (up to 40), plus '+getMemoryCount()+' saved memories.';list.textContent='';if(!rows.length){const empty=document.createElement('p');empty.className='history-empty';empty.textContent='Start chatting and this panel will show the context Glitch can refer to.';list.appendChild(empty);return;}rows.forEach(m=>{const row=document.createElement('div');row.className='context-row '+(m.role==='user'?'context-user':'context-assistant');const label=document.createElement('strong');label.textContent=m.role==='user'?'You':'Glitch';const body=document.createElement('p');body.textContent=String(m.content||'').slice(0,700);row.append(label,body);list.appendChild(row);});}
  $('contextOpen').addEventListener('click',async()=>{$('contextModal').classList.add('open');refreshContextPanel();if(getUser()){try{await loadMemories();refreshContextPanel();}catch{}}});
  $('contextClose').addEventListener('click',()=>$('contextModal').classList.remove('open'));
  $('contextModal').addEventListener('click',e=>{if(e.target===$('contextModal'))$('contextModal').classList.remove('open');});
  }
  window.GlitchContextPanel = { init: initContextPanel };
})();
