/* 공통: 레이아웃, 회원(목업), 저장소, 소득공제 계산 엔진 */
(function(){
const C = BT.company;
const $ = (s,el=document)=>el.querySelector(s), $$=(s,el=document)=>[...el.querySelectorAll(s)];
BT.$=$; BT.$$=$$;
BT.won = n => Math.round(n).toLocaleString('ko-KR');
BT.man = n => { n=Math.round(n); if(n>=100000000){const e=Math.floor(n/100000000), r=Math.round((n%100000000)/10000); return e+'억'+(r?' '+r.toLocaleString()+'만':'')+'원';} return (n/10000).toLocaleString('ko-KR')+'만원'; };
BT.qs = k => new URLSearchParams(location.search).get(k);
BT.esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- storage ---------- */
const S = {
  get(k,d){ try{const v=localStorage.getItem(k); return v?JSON.parse(v):d;}catch(e){return d;} },
  set(k,v){ localStorage.setItem(k,JSON.stringify(v)); }
};
BT.S=S;
BT.users = ()=>S.get('bt_users',[]);
BT.me = ()=>{ const id=S.get('bt_session',null); return id? BT.users().find(u=>u.id===id)||null : null; };
BT.saveUser = u => { const us=BT.users(); const i=us.findIndex(x=>x.id===u.id); if(i>=0) us[i]=u; else us.push(u); S.set('bt_users',us); };
BT.login = (id,pw)=>{ const u=BT.users().find(x=>x.id===id); if(!u) return '등록되지 않은 아이디입니다.'; if(u.pw!==BT.hash(pw)) return '비밀번호가 일치하지 않습니다.'; S.set('bt_session',u.id); return null; };
BT.logout = ()=>{ localStorage.removeItem('bt_session'); location.href='index.html'; };
BT.hash = s => { let h=5381; for(const c of String(s)) h=((h<<5)+h+c.charCodeAt(0))|0; return 'h'+(h>>>0).toString(16); }; // 목업용(실서비스는 서버 해시 필요)
if(!BT.users().some(u=>u.id==='demo')) BT.saveUser({id:'demo',pw:BT.hash('demo1234'),name:'홍길동',phone:'010-1234-5678',email:'demo@example.com',birth:'1980-01-01',addr:'경기도 성남시 분당구 (데모)',joined:'2026-11-27',mkt:false});
BT.investments = ()=>S.get('bt_invest',[]);
BT.myInvestments = ()=>{ const me=BT.me(); return me? BT.investments().filter(x=>x.uid===me.id):[]; };
BT.raisedOf = p => p.raised + BT.investments().filter(x=>x.pid===p.id && x.status!=='cancel').reduce((a,b)=>a+b.amount,0);
BT.requireLogin = (msg)=>{ if(BT.me()) return true; alert(msg||'회원 전용 서비스입니다. 로그인 후 이용해 주세요.'); location.href='login.html?next='+encodeURIComponent(location.pathname.split('/').pop()+location.search); return false; };
BT.statusLabel = s => ({open:['모집중','green'],soon:['모집예정','blue'],closed:['모집마감','gray']}[s]);

/* ---------- 소득공제 계산 엔진 ----------
 * 조세특례제한법 제16조: 3천만원 이하 100%, 3천~5천만원 70%, 5천만원 초과 30%
 * 공제한도: 종합소득금액의 50%
 * 세율: 종합소득세 기본세율(2023년 귀속~) + 지방소득세 10%  */
BT.BRACKETS = [ // [상한(원), 국세율]
  [14000000,0.06],[50000000,0.15],[88000000,0.24],[150000000,0.35],
  [300000000,0.38],[500000000,0.40],[1000000000,0.42],[Infinity,0.45]
];
BT.LOCAL = 0.10;
BT.taxOf = base => { // 지방소득세 포함 산출세액
  base=Math.max(0,base); let tax=0, prev=0;
  for(const [cap,r] of BT.BRACKETS){ if(base>prev){ tax += (Math.min(base,cap)-prev)*r; } prev=cap; }
  return tax*(1+BT.LOCAL);
};
BT.rateOf = base => { let prev=0; for(const [cap,r] of BT.BRACKETS){ if(base<=cap) return r*(1+BT.LOCAL); prev=cap;} };
BT.deductionRaw = inv => Math.min(inv,30000000)*1 + Math.max(0,Math.min(inv,50000000)-30000000)*0.7 + Math.max(0,inv-50000000)*0.3;
BT.calc = (income, inv) => {
  const raw = BT.deductionRaw(inv), limit = income*0.5;
  const ded = Math.min(raw, limit);
  const after = Math.max(0, income-ded);
  const taxBefore = BT.taxOf(income), taxAfter = BT.taxOf(after);
  const refund = taxBefore-taxAfter;
  return {income, inv, raw, limit, capped: raw>limit, ded, after, taxBefore, taxAfter, refund,
    ratio: inv? refund/inv:0, net: inv-refund, rateBefore: BT.rateOf(income)};
};
/* 성과배분(가정치) : 투자원금 × 가정 수익률 × 배분율 */
BT.SALE_SHARE = {in:0.5, after:0.2, ext:0.7};
BT.perf = (inv, opRate, saleRate, scen) => {
  const op = inv*(opRate/100)*0.5*3; // 3년간 운영 순이익의 50%
  const sale = inv*(saleRate/100)*BT.SALE_SHARE[scen||'in'];
  return {op, sale, total: op+sale};
};

/* ---------- 계산기 위젯 ---------- */
BT.mountCalc = (root, opts={}) => {
  const id = 'c'+Math.random().toString(36).slice(2,7);
  root.innerHTML = `
  <div class="calc">
    <div class="calc-in">
      <h3>소득공제 계산기</h3>
      <p class="desc">벤처기업 투자 소득공제(조세특례제한법 제16조) 예상 절세액</p>
      <div class="field"><label>연 소득 <small>(과세표준 기준)</small></label>
        <div class="inp"><input id="${id}-inc" inputmode="numeric" placeholder="예) 8,000" value="${opts.income||''}"><span class="unit">만원</span></div>
        <div class="chips">${[5000,8000,10000,20000,35000].map(v=>`<button type="button" class="chip" data-t="inc" data-v="${v}">${(v/10000>=1? (v/10000)+'억':v.toLocaleString()+'만')}</button>`).join('')}</div>
      </div>
      <div class="field"><label>투자금액 <small>(최소 500만원)</small></label>
        <div class="inp"><input id="${id}-inv" inputmode="numeric" placeholder="예) 3,000" value="${opts.inv||''}"><span class="unit">만원</span></div>
        <div class="chips">${[500,1000,3000,5000].map(v=>`<button type="button" class="chip" data-t="inv" data-v="${v}">${v.toLocaleString()}만</button>`).join('')}</div>
      </div>
      ${opts.perf?`<details class="field" style="margin-top:6px"><summary style="cursor:pointer;font-weight:700;font-size:14px">＋ 예상 성과배분 함께 보기 (가정치 입력)</summary>
        <div style="margin-top:12px" class="field"><label>가정 연 운영 순이익률 <small>(투자원금 대비)</small></label><div class="inp"><input id="${id}-op" inputmode="decimal" value="0"><span class="unit">%</span></div></div>
        <div class="field"><label>가정 매각 차익률 <small>(투자원금 대비)</small></label><div class="inp"><input id="${id}-sale" inputmode="decimal" value="0"><span class="unit">%</span></div></div>
        <div class="field"><label>매각 시나리오</label><div class="inp"><select id="${id}-scen"><option value="in">만기(3년) 내 매각 – 매각이익 50%</option><option value="after">만기 원금상환 후 매각 – 20%</option><option value="ext">만기 연장 후 매각 – 70%</option></select></div></div>
      </details>`:''}
      <div class="err" id="${id}-err"></div>
      <button class="btn btn-g btn-lg" style="width:100%" id="${id}-go">계산하기</button>
    </div>
    <div class="calc-out" id="${id}-out">
      <table><thead><tr><th>구분</th><th>과세표준</th><th>예상세액<br><small>(지방소득세 포함)</small></th></tr></thead>
      <tbody><tr><td>투자 전</td><td id="${id}-b1">-</td><td id="${id}-b2">-</td></tr>
      <tr><td>투자 후</td><td id="${id}-a1">-</td><td id="${id}-a2">-</td></tr></tbody></table>
      <div class="bar"><i id="${id}-bar" style="width:0"></i></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--sub);margin-bottom:18px"><span>투자 후 과세표준 / 투자 전 과세표준</span><span id="${id}-barp">-</span></div>
      <div class="result-box"><div><div class="lbl">예상 소득공제 혜택(환급) 금액은 최대</div><div class="val"><span id="${id}-ref">0</span><small>원</small></div></div>
        <div class="pct"><b id="${id}-pct">0%</b><span>투자금액 대비</span></div></div>
      <div class="mini">
        <div><dt>소득공제 금액</dt><dd id="${id}-ded">-</dd></div>
        <div><dt>실질 투자금 (투자금−환급)</dt><dd id="${id}-net">-</dd></div>
        <div><dt>적용 최고세율</dt><dd id="${id}-rate">-</dd></div>
      </div>
      <div id="${id}-perf" class="hide" style="margin-top:16px"></div>
      <p class="note" id="${id}-cap"></p>
      <p class="note">※ 본 절세 금액은 지방소득세를 포함한 추정치이며, 과세표준에서 소득공제액을 직접 차감하는 단순 계산입니다. 실제 환급액은 다른 공제·감면, 종합소득금액, 투자 요건 충족 여부 등에 따라 달라질 수 있습니다. 공제 적용 가능 여부는 반드시 세무 전문가와 확인하세요.</p>
      ${opts.cta?`<div class="mt16" style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn-p" href="products.html">투자상품 보기</a><a class="btn btn-o" href="guide.html#tax">소득공제 구조 알아보기</a></div>`:''}
    </div>
  </div>`;
  const num = el => parseFloat(String(el.value).replace(/[^0-9.]/g,''))||0;
  const fmtInput = el => el.addEventListener('input',()=>{ const v=String(el.value).replace(/[^0-9]/g,''); el.value = v? Number(v).toLocaleString():''; });
  const inc=$('#'+id+'-inc',root), inv=$('#'+id+'-inv',root); fmtInput(inc); fmtInput(inv);
  [inc,inv].forEach(e=>{ if(e.value) e.value=Number(e.value).toLocaleString(); e.addEventListener('keydown',ev=>{ if(ev.key==='Enter') run(); }); });
  $$('.chip',root).forEach(b=>b.onclick=()=>{ (b.dataset.t==='inc'?inc:inv).value=Number(b.dataset.v).toLocaleString(); run(); });
  const err=$('#'+id+'-err',root);
  function run(){
    err.textContent='';
    const I=num(inc)*10000, V=num(inv)*10000;
    if(!(I>0)){ err.textContent='연 소득(과세표준)을 올바르게 입력해 주세요.'; inc.focus(); return; }
    if(!(V>0)){ err.textContent='투자금액을 올바르게 입력해 주세요.'; inv.focus(); return; }
    if(V<BT.MIN_INVEST){ err.textContent='최소 500만원 이상을 입력해 주세요.'; inv.focus(); return; }
    const r=BT.calc(I,V);
    const set=(k,v)=>$('#'+id+'-'+k,root).innerHTML=v;
    set('b1',BT.man(r.income)); set('b2',BT.won(r.taxBefore)+'원');
    set('a1',BT.man(r.after)); set('a2',BT.won(r.taxAfter)+'원');
    set('ref',BT.won(r.refund)); set('pct',(r.ratio*100).toFixed(1)+'%');
    set('ded',BT.man(r.ded)); set('net',BT.man(r.net)); set('rate',(r.rateBefore*100).toFixed(1)+'%');
    const p=r.income? r.after/r.income:0; $('#'+id+'-bar',root).style.width=(p*100)+'%'; set('barp',(p*100).toFixed(1)+'%');
    set('cap', r.capped? `⚠️ 공제 대상액 ${BT.man(r.raw)} 중 공제한도(종합소득금액의 50% = ${BT.man(r.limit)})를 초과하여 ${BT.man(r.ded)}만 공제됩니다.` : '');
    $('#'+id+'-cap',root).className='note warn';
    if(opts.perf){
      const op=num($('#'+id+'-op',root)), sl=num($('#'+id+'-sale',root)), sc=$('#'+id+'-scen',root).value;
      const box=$('#'+id+'-perf',root);
      if(op>0||sl>0){ const f=BT.perf(V,op,sl,sc); box.classList.remove('hide');
        box.innerHTML=`<div class="mini"><div><dt>운영수익 배분 (3년, 가정)</dt><dd>${BT.won(f.op)}원</dd></div><div><dt>매각이익 배분 (가정)</dt><dd>${BT.won(f.sale)}원</dd></div><div><dt>세금환급 + 성과배분 합계</dt><dd style="color:var(--blue)">${BT.won(r.refund+f.total)}원</dd></div></div><p class="note">※ 성과배분은 입력하신 가정 수익률로 계산한 단순 예시로, 실제 배분은 손익계산서상 당기순이익 및 투자지분에 따라 달라지며 보장되지 않습니다. 배당소득세 등 세금은 반영하지 않았습니다.</p>`;
      } else box.classList.add('hide');
    }
    if(opts.onResult) opts.onResult(r);
  }
  $('#'+id+'-go',root).onclick=run;
  if(inc.value && inv.value) run();
  return {run};
};

/* ---------- 레이아웃 ---------- */
const NAV=[['about.html','회사소개'],['guide.html','소득공제형 투자'],['products.html','투자상품'],['calculator.html','소득공제 계산기'],['notice.html','공지사항'],['faq.html','FAQ'],['partner.html','물건제안·제휴']];
function header(){
  const me=BT.me(), cur=location.pathname.split('/').pop()||'index.html';
  const util = me? `<span class="pc" style="font-size:14px;color:var(--sub)"><b style="color:var(--navy)">${BT.esc(me.name)}</b>님</span><a class="btn btn-o btn-sm" href="mypage.html">마이페이지</a><button class="btn btn-sm btn-o pc" onclick="BT.logout()">로그아웃</button>`
   : `<a class="btn btn-o btn-sm" href="login.html">로그인</a><a class="btn btn-p btn-sm pc" href="join.html">회원가입</a>`;
  return `<header class="hd"><div class="wrap">
    <a class="logo" href="index.html"><b>BLOCK TOWN</b><small>부동산 경매 조각투자 · (주)업타운</small></a>
    <nav class="gnb">${NAV.map(([h,t])=>`<a href="${h}" class="${cur===h||(h==='products.html'&&/product|invest/.test(cur))?'on':''}">${t}</a>`).join('')}</nav>
    <div class="hd-util">${util}</div>
    <button class="menu-btn" aria-label="메뉴" onclick="document.querySelector('.mnav').classList.toggle('open')">☰</button>
  </div></header>
  <nav class="mnav">${NAV.map(([h,t])=>`<a href="${h}">${t}</a>`).join('')}${me?`<a href="mypage.html">마이페이지</a><a href="#" onclick="BT.logout();return false">로그아웃</a>`:`<a href="login.html">로그인</a><a href="join.html">회원가입</a>`}</nav>`;
}
function footer(){
  return `<footer class="ft"><div class="wrap">
   <div class="top-row"><a class="logo" href="index.html"><b>BLOCK TOWN</b><small>부동산 경매 조각투자</small></a>
    <div class="flinks"><a href="terms.html">이용약관</a><a class="b" href="privacy.html">개인정보처리방침</a><a href="risk.html">투자위험 고지</a><a href="risk.html#limit">책임의 한계 고지</a><a href="faq.html">FAQ</a></div></div>
   <div class="info"><span>${C.name}</span><span>대표이사 : ${C.ceo}</span><span>사업자등록번호 : ${C.bizNo}</span><br>
    <span>주소 : ${C.addr}</span><br><span>TEL : ${C.tel}</span><span>E-MAIL : ${C.email}</span><span>벤처기업확인 : ${C.venture.type} (${C.venture.period}, ${C.venture.no})</span></div>
   <div class="riskline"><b style="color:#ffd77a">투자위험 고지</b> · 모든 투자에는 원금 손실의 가능성이 있습니다. 전환사채는 예금자보호법에 따라 보호되지 않으며, 발행회사의 사업·재무 상황, 부동산 시장 변동, 매각 지연 등에 따라 원금 및 성과배분이 지급되지 않거나 지연될 수 있습니다. 소득공제 효과는 개인별 소득·공제 요건에 따라 달라지며, 의무보유기간(3년) 이내 회수 시 추징될 수 있습니다. 투자 전 투자설명서와 계약서를 반드시 확인하세요. 본 사이트의 상품 정보 중 ‘예시’로 표시된 내용은 실제 모집 상품이 아닙니다.</div>
   <div class="copy">COPYRIGHT © ${new Date().getFullYear()} UPTOWN CO., LTD. ALL RIGHTS RESERVED.</div>
  </div></footer>
  <div class="fab"><a class="kk" href="#" onclick="BT.toast('카카오톡 채널 상담은 채널 개설 후 연결됩니다. 전화 ${C.tel}');return false">💬<span>상담</span></a><button class="top" onclick="scrollTo({top:0,behavior:'smooth'})">TOP</button></div>
  <div class="toast" id="toast"></div>`;
}
BT.toast = (m)=>{ const t=$('#toast'); if(!t) return alert(m); t.textContent=m; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),2600); };
BT.modal = (html)=>{ let m=$('#bt-modal'); if(!m){ m=document.createElement('div'); m.id='bt-modal'; m.className='modal'; m.innerHTML='<div class="mbox"><button class="x" aria-label="닫기">×</button><div class="mc"></div></div>'; document.body.appendChild(m); m.onclick=e=>{ if(e.target===m||e.target.classList.contains('x')) m.classList.remove('open'); }; }
  $('.mc',m).innerHTML=html; m.classList.add('open'); };
BT.subHero = (title,desc,crumb)=>`<section class="sub-hero"><div class="wrap"><div class="crumb">HOME › ${crumb||title}</div><h1>${title}</h1>${desc?`<p>${desc}</p>`:''}</div></section>`;
document.addEventListener('DOMContentLoaded',()=>{
  const h=$('#hd'), f=$('#ft'); if(h) h.outerHTML=header(); if(f) f.outerHTML=footer();
});

/* 상품 카드 */
BT.productCard = p => { const [lb,cl]=BT.statusLabel(p.status); const raised=BT.raisedOf(p); const pct=Math.min(100,Math.round(raised/p.target*100));
  return `<a class="pcard" href="product.html?id=${p.id}"><div class="thumb" style="background:${p.grad}"><div class="tag"><span class="badge ${cl}">${lb}</span><span class="badge gold">소득공제</span></div>${p.example?'<span class="ex">예시 상품</span>':''}<span class="bld">${p.icon}</span></div>
  <div class="body"><h3>${p.title}</h3><div class="loc">${p.asset}</div>
  <dl><div><dt>모집금액</dt><dd>${BT.man(p.target)}</dd></div><div><dt>최소 투자금</dt><dd>500만원</dd></div><div><dt>기본이율</dt><dd>연 0%</dd></div><div><dt>성과보수</dt><dd>순이익 50%</dd></div><div><dt>만기</dt><dd>3년 (36개월)</dd></div><div><dt>소득공제</dt><dd style="color:var(--blue)">최대 100%</dd></div></dl>
  <div class="prog"><div class="row"><span>모집 ${p.start.slice(5).replace('-','.')} ~ ${p.end.slice(5).replace('-','.')}</span><b>${pct}%</b></div><div class="bar"><i style="width:${pct}%"></i></div></div></div></a>`; };
})();
