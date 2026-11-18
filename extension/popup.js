// Deliberately user-initiated and restricted to the active Beatport tab.
const api=typeof browser!=='undefined'?browser:chrome;
const button=document.getElementById('run'),result=document.getElementById('result');
button.addEventListener('click',async()=>{
  button.disabled=true;result.textContent='Checking Beatport…';
  try{
    const [tab]=await api.tabs.query({active:true,currentWindow:true});
    const url=new URL(tab.url||'');
    if(!['www.beatport.com','beatport.com'].includes(url.hostname)||url.protocol!=='https:')throw Error('Open your Beatport playlist in this browser tab first.');
    // Execute on explicit user click only. Avoid guessing undocumented endpoints.
    const results=await api.scripting.executeScript({target:{tabId:tab.id},func:()=>{
      const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!el.disabled};
      const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(visible).filter(el=>/^(buy all|add all to cart)$/i.test((el.innerText||el.getAttribute('aria-label')||'').trim()));
      if(buttons.length!==1)return {ok:false,message:buttons.length?'Multiple purchase buttons detected; open a single playlist detail page.':'No playlist Buy All button found. Open a playlist detail page, then retry.'};
      const text=(document.querySelector('h1')?.textContent||'').trim();
      if(!window.confirm('Add the tracks from the open Beatport page'+(text?' (“'+text.slice(0,85)+'”)':'')+' to your cart?'))return {ok:false,message:'Cancelled'};
      buttons[0].click();
      return {ok:true,message:'Buy All click sent. Please check Beatport’s cart for confirmation; this extension cannot verify that items were added.'};
    }});
    result.textContent=results?.[0]?.result?.message||'Unable to inspect the page.';
  }catch(error){result.textContent=error?.message||'Could not access Beatport page.'}
  finally{button.disabled=false}
});