(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const state = { token: sessionStorage.getItem("brokerflow_token") || "", user: null, data: null, language: localStorage.getItem("brokerflow_language") || "en" };
  const words = {
    en: {
      visits:"visits",relationships:"relationships",welcome:"Welcome back",loginSubtitle:"Sign in to explore your sales performance and business relationships.",email:"Email address",password:"Password",signIn:"Sign in",workspace:"WORKSPACE",overview:"Overview",relationships:"Relationships",visits:"Visits",signOut:"Sign out",workspaceOverview:"WORKSPACE OVERVIEW",dashboard:"Dashboard",analyticsFor:"Analytics for",allCompanies:"All companies",last7:"Last 7 days",last30:"Last 30 days",last90:"Last 90 days",last365:"Last 12 months",allTime:"All time",visitTrend:"Visit activity",visitTrendSub:"Monthly visit volume in the selected period",visitStatus:"Visit status",visitStatusSub:"Current period breakdown",teamPerformance:"Team performance",teamPerformanceSub:"Visits by team",topCompanies:"Top companies",topCompaniesSub:"Visits by company",sourceTeams:"Teams in Google Sheets",sourceTeamsSub:"Current source relationships",agentActivity:"Sales agent activity",agentActivitySub:"Source records by sales agent",dataExplorer:"DATA EXPLORER",relationshipMap:"Relationship explorer",relationshipSub:"Explore how managers, agents, companies, teams and groups connect.",from:"FROM",to:"CONNECTED TO",records:"RECORDS",dataHealth:"Data health",dataHealthSub:"Missing fields in your source data",recentVisits:"Recent visits",recentVisitsSub:"Latest activity in your companies",footer:"Sales intelligence workspace",totalCompanies:"Companies",members:"Company members",teams:"Teams",totalVisits:"Visits in period",completed:"Completed visits",cancelled:"Cancelled visits",sourceRecords:"Source records",sourceCompanies:"Source companies",sourceAgents:"Sales agents",sourceManagers:"Sales managers",sourceTeamsKpi:"Source teams",sourceGroups:"Client groups",dropdownCompanies:"Dropdown companies",noData:"No data available for this selection",loading:"Loading dashboard…",loginFailed:"Unable to sign in. Check your credentials.",sessionExpired:"Your session expired. Please sign in again.",networkError:"Unable to load dashboard data. Please try again.",directMatches:"Direct email matches",agentMatches:"Sales Agent matches",missingEmail:"Records without email",missingAgent:"Records without Sales Agent",missingCompany:"Records without company",allRelationships:"All relationships",managerToAgents:"Manager → Sales Agents",managerToCompanies:"Manager → Companies",agentToCompanies:"Sales Agent → Companies",agentToEmails:"Sales Agent → Emails",emailToCompanies:"Email → Companies",companyToGroups:"Company → Client Groups",companyToTeams:"Company → Source Teams",teamToAgents:"Team → Sales Agents",managerToTeams:"Manager → Teams",groupToTeams:"Client Group → Teams",dropdownIdToCompany:"Dropdown ID → Company",dropdownAgentToCompany:"Dropdown Sales Agent → Company",companyToMembers:"Company → Members",companyToTeamsDb:"Company → App Teams",teamToMembersDb:"App Team → Members",teamToVisitsDb:"Team → Company visits",visitToCreator:"Company → Visit creators",visitToAssignees:"Company → Visit assignees",orientationCompanyToAgents:"Orientation company → Sales Agents",orientationAgentToManagers:"Orientation Sales Agent → Managers",orientationCompanyToBrokerAdmins:"Company → Broker Admins",orientationTypeToBrokerType:"Activity → Broker Type",orientationLocationInToOut:"Check-in → Check-out locations",orientationEmailToAgents:"Email → Sales Agents",orientationProjectToCompany:"Project ID → Company",orientationRequestToCompany:"Request → Company",managerVisits:"Visits by manager and team",managerVisitsSub:"All managers, teams, sales agents and their Orientation visits",unassignedSales:"Sales agents without a manager",noManagerFound:"No manager relationship was found for this sales agent.",noAdminHierarchy:"No manager or sales hierarchy data is available.",noRelationships:"No relationships found for this selection.",sourceData:"Google Sheets",noRecentVisits:"No recent visits in this period.",refresh:"Dashboard updated",lastSync:"Last sync",notSynced:"Sync time unavailable",unknown:"Unknown",scheduled:"Scheduled",inProgress:"In progress",completedStatus:"Completed",cancelledStatus:"Cancelled",noShow:"No show",unassigned:"Unassigned team",visitsCount:"visits",recordsCount:"records",createdBy:"Created by",direct:"Direct email",agentMatch:"Agent match",dataQuality:"Source data quality"
    },
    ar: {
      visits:"زيارة",relationships:"العلاقات",welcome:"مرحبًا بعودتك",loginSubtitle:"سجّل الدخول لمتابعة أداء المبيعات والعلاقات بين البيانات.",email:"البريد الإلكتروني",password:"كلمة المرور",signIn:"تسجيل الدخول",workspace:"مساحة العمل",overview:"نظرة عامة",relationships:"العلاقات",visits:"الزيارات",signOut:"تسجيل الخروج",workspaceOverview:"نظرة عامة على مساحة العمل",dashboard:"لوحة التحكم",analyticsFor:"التحليلات خلال",allCompanies:"كل الشركات",last7:"آخر 7 أيام",last30:"آخر 30 يومًا",last90:"آخر 90 يومًا",last365:"آخر 12 شهرًا",allTime:"كل الوقت",visitTrend:"نشاط الزيارات",visitTrendSub:"حجم الزيارات شهريًا خلال الفترة المحددة",visitStatus:"حالة الزيارات",visitStatusSub:"توزيع الحالات خلال الفترة",teamPerformance:"أداء الفرق",teamPerformanceSub:"الزيارات حسب الفريق",topCompanies:"أكثر الشركات نشاطًا",topCompaniesSub:"الزيارات حسب الشركة",sourceTeams:"الفرق في Google Sheets",sourceTeamsSub:"العلاقات الحالية في بيانات المصدر",agentActivity:"نشاط مندوبي المبيعات",agentActivitySub:"سجلات المصدر حسب المندوب",dataExplorer:"مستكشف البيانات",relationshipMap:"مستكشف العلاقات",relationshipSub:"استكشف ارتباط المديرين والمندوبين والشركات والفرق والمجموعات.",from:"من",to:"مرتبط بـ",records:"السجلات",dataHealth:"جودة البيانات",dataHealthSub:"الحقول الناقصة في بيانات المصدر",recentVisits:"أحدث الزيارات",recentVisitsSub:"آخر الأنشطة في شركاتك",footer:"مساحة عمل ذكاء المبيعات",totalCompanies:"الشركات",members:"أعضاء الشركات",teams:"الفرق",totalVisits:"الزيارات خلال الفترة",completed:"الزيارات المكتملة",cancelled:"الزيارات الملغاة",sourceRecords:"سجلات المصدر",sourceCompanies:"شركات المصدر",sourceAgents:"مندوبو المبيعات",sourceManagers:"مديرو المبيعات",sourceTeamsKpi:"فرق المصدر",sourceGroups:"مجموعات العملاء",dropdownCompanies:"شركات القائمة",noData:"لا توجد بيانات لهذا الاختيار",loading:"جارٍ تحميل لوحة التحكم…",loginFailed:"تعذر تسجيل الدخول. راجع بيانات الحساب.",sessionExpired:"انتهت الجلسة. سجّل الدخول مرة أخرى.",networkError:"تعذر تحميل بيانات لوحة التحكم. حاول مرة أخرى.",directMatches:"مطابقة البريد مباشرة",agentMatches:"مطابقة اسم المندوب",missingEmail:"سجلات بدون بريد",missingAgent:"سجلات بدون مندوب",missingCompany:"سجلات بدون شركة",allRelationships:"كل العلاقات",managerToAgents:"المدير ← مندوبو المبيعات",managerToCompanies:"المدير ← الشركات",agentToCompanies:"المندوب ← الشركات",agentToEmails:"المندوب ← البريد الإلكتروني",emailToCompanies:"البريد الإلكتروني ← الشركات",companyToGroups:"الشركة ← مجموعات العملاء",companyToTeams:"الشركة ← فرق المصدر",teamToAgents:"الفريق ← مندوبو المبيعات",managerToTeams:"المدير ← الفرق",groupToTeams:"مجموعة العملاء ← الفرق",dropdownIdToCompany:"كود القائمة ← الشركة",dropdownAgentToCompany:"مندوب القائمة ← الشركة",companyToMembers:"الشركة ← الأعضاء",companyToTeamsDb:"الشركة ← فرق التطبيق",teamToMembersDb:"فريق التطبيق ← الأعضاء",teamToVisitsDb:"الفريق ← زيارات الشركة",visitToCreator:"الشركة ← منشئو الزيارات",visitToAssignees:"الشركة ← المسؤولون عن الزيارات",orientationCompanyToAgents:"شركات الزيارات ← المندوبون",orientationAgentToManagers:"مندوبو الزيارات ← المديرون",orientationCompanyToBrokerAdmins:"الشركة ← مسؤولوها",orientationTypeToBrokerType:"نوع النشاط ← نوع الوسيط",orientationLocationInToOut:"مواقع الدخول ← الخروج",orientationEmailToAgents:"البريد ← المندوبون",orientationProjectToCompany:"كود المشروع ← الشركة",orientationRequestToCompany:"الطلب ← الشركة",managerVisits:"الزيارات حسب المدير والفريق",managerVisitsSub:"كل المديرين والفرق والمندوبين وزيارات الـ Orientation التابعة لهم",unassignedSales:"مندوبو المبيعات بدون مدير",noManagerFound:"لم يتم العثور على مدير مرتبط بهذا المندوب.",noAdminHierarchy:"لا تتوفر بيانات للمديرين أو هيكل المبيعات.",noRelationships:"لا توجد علاقات لهذا الاختيار.",sourceData:"Google Sheets",noRecentVisits:"لا توجد زيارات حديثة خلال هذه الفترة.",refresh:"تم تحديث لوحة التحكم",lastSync:"آخر مزامنة",notSynced:"وقت المزامنة غير متاح",unknown:"غير معروف",scheduled:"مجدولة",inProgress:"قيد التنفيذ",completedStatus:"مكتملة",cancelledStatus:"ملغاة",noShow:"لم يحضر",unassigned:"بدون فريق",visitsCount:"زيارة",recordsCount:"سجل",createdBy:"أنشأها",direct:"بريد مباشر",agentMatch:"مطابقة المندوب",dataQuality:"جودة بيانات المصدر"
    }
  };
  const t = k => words[state.language][k] || words.en[k] || k;
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = v => new Intl.NumberFormat(state.language === "ar" ? "ar-EG" : "en-US").format(Number(v || 0));
  const date = v => v ? new Intl.DateTimeFormat(state.language === "ar" ? "ar-EG" : "en-US",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)) : "—";
  const relationKeys = ["managerToAgents","managerToCompanies","agentToCompanies","agentToEmails","emailToCompanies","companyToGroups","companyToTeams","teamToAgents","managerToTeams","groupToTeams","dropdownIdToCompany","dropdownAgentToCompany","companyToMembers","companyToTeamsDb","teamToMembersDb","teamToVisitsDb","visitToCreator","visitToAssignees","orientationCompanyToAgents","orientationAgentToManagers","orientationCompanyToBrokerAdmins","orientationTypeToBrokerType","orientationLocationInToOut","orientationEmailToAgents","orientationProjectToCompany","orientationRequestToCompany"];
  const palette = ["#4169e1","#20a58b","#e5a24d","#8a72d6","#e07883","#50a9c6","#8ca0b8"];
  function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600);}
  function setLanguage(lang){
    state.language=lang;localStorage.setItem("brokerflow_language",lang);
    document.documentElement.lang=lang;document.documentElement.dir=lang==="ar"?"rtl":"ltr";
    $("languageBtn").textContent=lang==="ar"?"English":"عربي";
    document.querySelectorAll("[data-i18n]").forEach(el=>{const k=el.dataset.i18n;if(words[lang][k])el.textContent=words[lang][k];});
    if(state.data){renderDashboard(state.data);populateRelations(state.data.relationships||{});renderRelations(state.data.relationships||{});}
  }
  async function api(path,options){
    options=options||{};const headers=Object.assign({"Content-Type":"application/json"},options.headers||{});
    if(state.token)headers.Authorization="Bearer "+state.token;
    const response=await fetch(path,Object.assign({},options,{headers}));
    const body=await response.json().catch(()=>({}));
    if(response.status===401){logout();throw new Error(t("sessionExpired"));}
    if(!response.ok)throw new Error(body.message||("Request failed ("+response.status+")"));
    return body;
  }
  function showApp(user){
    state.user=user||state.user;$("loginView").classList.add("hidden");$("appView").classList.remove("hidden");
    if(state.user){$("userName").textContent=state.user.fullName||"User";$("userEmail").textContent=state.user.email||"";$("userAvatar").textContent=(state.user.fullName||"U").trim().charAt(0).toUpperCase();}
    setLanguage(state.language);
  }
  function logout(){state.token="";state.user=null;state.data=null;sessionStorage.removeItem("brokerflow_token");$("appView").classList.add("hidden");$("loginView").classList.remove("hidden");}
  async function login(event){
    event.preventDefault();const button=$("loginForm").querySelector("button");$("loginError").textContent="";button.disabled=true;button.textContent=t("loading");
    try{const result=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:$("email").value.trim(),password:$("password").value})});state.token=result.token;state.user=result.user;sessionStorage.setItem("brokerflow_token",state.token);showApp(result.user);await loadDashboard();}
    catch(err){$("loginError").textContent=err.message||t("loginFailed");}
    finally{button.disabled=false;button.textContent=t("signIn");}
  }
  async function loadDashboard(showMessage){
    if(!state.token)return;$("refreshBtn").disabled=true;
    try{
      const params=new URLSearchParams({period:$("periodFilter").value||"30d"});if($("companyFilter").value)params.set("companyId",$("companyFilter").value);
      const data=await api("/api/dashboard/overview?"+params.toString());state.data=data;state.user=data.user||state.user;showApp(state.user);
      populateCompanies(data.companies||[]);renderDashboard(data);populateRelations(data.relationships||{});renderRelations(data.relationships||{});
      const orientationInfo=data.orientationSource||{};
      const sheetSync=data.lastGoogleSheetSyncAt?t("lastSync")+" "+date(data.lastGoogleSheetSyncAt):t("notSynced");
      const orientationStatus=orientationInfo.status==="connected"
        ? (state.language==="ar"?"الـ Orientations: متصل · "+num(orientationInfo.recordsReturned)+" سجل":"Orientations: connected · "+num(orientationInfo.recordsReturned)+" records")
        : (state.language==="ar"?"تعذر تحميل الـ Orientations: "+(orientationInfo.error||"خطأ غير معروف"):"Orientations unavailable: "+(orientationInfo.error||"Unknown error"));
      $("syncText").textContent=sheetSync+" · "+orientationStatus;
      $("periodLabel").textContent=({"7d":t("last7"),"30d":t("last30"),"90d":t("last90"),"365d":t("last365"),"all":t("allTime")})[$("periodFilter").value]||t("last30");
      if(showMessage)toast(t("refresh"));
    }catch(err){if(err.message!==t("sessionExpired"))toast(err.message||t("networkError"));}
    finally{$("refreshBtn").disabled=false;}
  }
  function populateCompanies(companies){
    const select=$("companyFilter"),current=select.value;
    select.innerHTML='<option value="">'+esc(t("allCompanies"))+'</option>'+companies.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("");
    if(Array.from(select.options).some(o=>o.value===current))select.value=current;
  }
  function renderDashboard(data){
    const s=data.summary||{};
    const cards=[["totalCompanies",s.companies,"▦",t("members")+": "+num(s.members)],["teams",s.teams,"⌘",t("sourceTeamsKpi")+": "+num(s.sourceTeams)],["totalVisits",s.visitsInPeriod,"◷",t("completed")+": "+num(s.completedVisits)],["sourceRecords",s.sourceRecords,"≋",t("sourceCompanies")+": "+num(s.sourceCompanies)]];
    $("kpiGrid").innerHTML=cards.map(c=>'<article class="kpi-card"><div class="kpi-top"><span>'+esc(t(c[0]))+'</span><span class="kpi-icon">'+c[2]+'</span></div><div class="kpi-value">'+num(c[1])+'</div><div class="kpi-note">'+esc(c[3])+'</div></article>').join("");
    const charts=data.charts||{};
    renderLine("visitTrend",charts.orientationByMonth?.length?charts.orientationByMonth:(charts.visitsByMonth||[]));
    renderDonut("statusChart",charts.orientationByType?.length?charts.orientationByType:(charts.visitsByStatus||[]));
    renderBars("teamChart",charts.orientationByManager?.length?charts.orientationByManager:(charts.visitsByTeam||[]));
    renderBars("companyChart",charts.orientationByCompany?.length?charts.orientationByCompany:(charts.visitsByCompany||[]));
    renderBars("sourceTeamChart",charts.orientationByAgent?.length?charts.orientationByAgent:(charts.sourceByTeam||[]));
    renderBars("agentChart",charts.orientationByBrokerType?.length?charts.orientationByBrokerType:(charts.sourceByAgent||[]));
    renderHealth(data);renderVisits(data.orientationVisits||data.recentVisits||[]);
    renderAdminHierarchy(data.managerHierarchy, data.user?.role === "ADMIN");
  }
  function renderAdminHierarchy(hierarchy, isAdmin){
    const section=$("adminVisitsSection");
    if(!section)return;
    section.classList.toggle("hidden",!isAdmin);
    if(!isAdmin)return;
    const managers=hierarchy?.managers||[],orphans=hierarchy?.unassignedAgents||[],summary=hierarchy?.summary||{};
    $("adminHierarchyCount").textContent=num(summary.visits||0)+" "+(state.language==="ar"?"زيارة":"visits");
    $("adminHierarchySummary").innerHTML=[
      [state.language==="ar"?"المديرون":"Managers",summary.managers??managers.length],
      [state.language==="ar"?"الفرق":"Teams",summary.teams??0],
      [state.language==="ar"?"مندوبون بدون مدير":"Sales without manager",summary.unassignedAgents??orphans.length],
      [state.language==="ar"?"زيارات غير مرتبطة بمندوب":"Unassigned visits",summary.unassignedVisits??0]
    ].map(x=>'<div class="admin-stat"><span>'+esc(x[0])+'</span><strong>'+num(x[1])+'</strong></div>').join("");
    const ar=state.language==="ar",label=(en,arabic)=>ar?arabic:en;
    const renderVisit=visit=>{
      const fields=[
        [label("Date","التاريخ"),visit.date||date(visit.scheduledAt)],
        [label("Company","الشركة"),visit.companyName],
        [label("Time in","وقت الدخول"),visit.timeIn],
        [label("Time out","وقت الخروج"),visit.timeOut],
        [label("Sales Agent","المندوب"),visit.salesAgent],
        [label("Sales Manager","المدير"),visit.salesManager],
        [label("Broker Admin","مسؤول الشركة"),visit.brokerAdmin],
        [label("Broker Type","نوع الوسيط"),visit.brokerType],
        [label("Activity","النشاط"),visit.type],
        [label("Request","رقم الطلب"),visit.requestNumber],
        [label("Project ID","كود المشروع"),visit.projectId],
        [label("Check-in","موقع الدخول"),visit.locationIn],
        [label("Check-out","موقع الخروج"),visit.locationOut],
        [label("Email","البريد"),visit.email],
        [label("Duplicate","مكرر"),visit.isDuplicate]
      ].filter(x=>x[1]!==null&&x[1]!==undefined&&String(x[1]).trim()!=="");
      return '<article class="admin-visit-card"><strong>'+esc(visit.companyName||"—")+'</strong><div class="admin-visit-fields">'+fields.map(x=>'<span><b>'+esc(x[0])+':</b> '+esc(x[1])+'</span>').join("")+'</div></article>';
    };
    const renderAgent=agent=>'<details class="admin-agent"><summary><span>'+esc(agent.name)+'</span><em>'+num(agent.visitCount||agent.visits?.length||0)+' '+esc(label("visits","زيارة"))+'</em></summary><div class="admin-agent-visits">'+(agent.visits||[]).map(renderVisit).join("")+'</div></details>';
    const renderTeam=team=>'<details class="admin-team"><summary><span>'+esc(team.name)+'</span><em>'+num(team.visitCount||0)+' '+esc(label("visits","زيارة"))+'</em></summary><div class="admin-team-agents">'+(team.agents||[]).map(renderAgent).join("")+'</div></details>';
    const managerHtml=managers.map(manager=>'<details class="admin-manager"><summary><span>'+esc(manager.name)+'</span><em>'+num(manager.visitCount||0)+' '+esc(label("visits","زيارة"))+' · '+num(manager.teams?.length||0)+' '+esc(label("teams","فرق"))+'</em></summary><div class="admin-manager-content">'+(manager.teams||[]).map(renderTeam).join("")+(manager.unassignedVisits?.length?'<details class="admin-team"><summary>'+esc(label("Visits without sales agent","زيارات بدون مندوب"))+' · '+num(manager.unassignedVisits.length)+'</summary>'+manager.unassignedVisits.map(renderVisit).join("")+'</details>':"")+'</div></details>').join("");
    const orphanHtml=orphans.length?'<div class="admin-orphans"><h3>'+esc(t("unassignedSales"))+'</h3><p>'+esc(t("noManagerFound"))+'</p>'+orphans.map(agent=>'<details class="admin-manager orphan-manager"><summary><span>'+esc(agent.name)+'</span><em>'+num(agent.visitCount||0)+' '+esc(label("visits","زيارة"))+' · '+num(agent.teams?.length||0)+' '+esc(label("teams","فرق"))+'</em></summary><div class="admin-manager-content">'+(agent.teams||[]).map(renderTeam).join("")+'</div></details>').join("")+'</div>':"";
    const noAgentHtml=(hierarchy?.unassignedVisits||[]).length?'<details class="admin-manager"><summary>'+esc(label("Visits without assigned sales agent","زيارات بدون مندوب محدد"))+' · '+num(hierarchy.unassignedVisits.length)+'</summary>'+hierarchy.unassignedVisits.map(renderVisit).join("")+'</details>':"";
    $("adminHierarchy").innerHTML=managerHtml+orphanHtml+noAgentHtml||'<div class="empty-chart">'+esc(t("noAdminHierarchy"))+'</div>';
  }
  function renderBars(id,items){
    const root=$(id);if(!items.length){root.innerHTML='<div class="empty-chart">'+esc(t("noData"))+'</div>';return;}
    const list=items.slice(0,7),max=Math.max(1,...list.map(x=>Number(x.value)));
    root.innerHTML=list.map(x=>'<div class="bar-item"><span class="bar-name" title="'+esc(x.label)+'">'+esc(x.label)+'</span><div class="bar-track"><div class="bar-fill" style="width:'+Math.max(2,Number(x.value)/max*100)+'%"></div></div><span class="bar-value">'+num(x.value)+'</span></div>').join("");
  }
  function renderDonut(id,items){
    const root=$(id);if(!items.length){root.innerHTML='<div class="empty-chart">'+esc(t("noData"))+'</div>';return;}
    const total=items.reduce((a,x)=>a+Number(x.value),0),circ=2*Math.PI*48;let offset=0;
    const arcs=items.map((x,i)=>{const length=circ*Number(x.value)/Math.max(1,total);const part='<circle cx="60" cy="60" r="48" fill="none" stroke="'+palette[i%palette.length]+'" stroke-width="13" stroke-dasharray="'+length+' '+(circ-length)+'" stroke-dashoffset="'+(-offset)+'"></circle>';offset+=length;return part;}).join("");
    root.innerHTML='<div class="donut-wrap"><svg viewBox="0 0 120 120">'+arcs+'</svg><div class="donut-center"><strong>'+num(total)+'</strong><span>'+esc(t("visits"))+'</span></div></div><div class="legend">'+items.slice(0,7).map((x,i)=>'<div class="legend-row"><i class="legend-dot" style="background:'+palette[i%palette.length]+'"></i><span>'+esc(statusLabel(x.label))+'</span><b>'+num(x.value)+'</b></div>').join("")+'</div>';
  }
  function renderLine(id,items){
    const root=$(id);if(!items.length){root.innerHTML='<div class="empty-chart">'+esc(t("noData"))+'</div>';return;}
    const w=640,h=220,l=35,r=12,top=15,b=35,max=Math.max(1,...items.map(x=>Number(x.value)));
    const pts=items.map((item,i)=>({x:items.length===1?(l+w-r)/2:l+i*(w-l-r)/(items.length-1),y:top+(1-Number(item.value)/max)*(h-top-b),item}));
    const path=pts.map((p,i)=>(i?"L":"M")+p.x+","+p.y).join(" "),area=path+" L"+pts[pts.length-1].x+","+(h-b)+" L"+pts[0].x+","+(h-b)+" Z";
    const grid=[0,1,2,3].map(i=>{const y=top+i*(h-top-b)/3;return '<line class="chart-grid" x1="'+l+'" y1="'+y+'" x2="'+(w-r)+'" y2="'+y+'"/>';}).join("");
    const dots=pts.map(p=>'<circle class="chart-dot" cx="'+p.x+'" cy="'+p.y+'" r="4"><title>'+esc(p.item.label)+": "+num(p.item.value)+'</title></circle>').join("");
    const labels=pts.map((p,i)=>{if(items.length>8&&i%Math.ceil(items.length/6)!==0&&i!==items.length-1)return "";return '<text class="chart-label" x="'+p.x+'" y="'+(h-9)+'" text-anchor="middle">'+esc(p.item.label)+'</text>';}).join("");
    root.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(t("visitTrend"))+'"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#4169e1" stop-opacity=".2"/><stop offset="100%" stop-color="#4169e1" stop-opacity="0"/></linearGradient></defs>'+grid+'<path class="area" d="'+area+'"/><path class="chart-line" d="'+path+'"/>'+dots+labels+'</svg>';
  }
  function renderHealth(data){
    const q=data.dataQuality||{},total=Math.max(1,Number(data.summary?.sourceRecords||0));
    const rows=[[t("missingEmail"),q.sourceRecordsMissingEmail||0],[t("missingAgent"),q.sourceRecordsMissingAgent||0],[t("missingCompany"),q.sourceRecordsMissingCompany||0]];
    $("dataHealth").innerHTML=rows.map(x=>'<div class="health-row"><span>'+esc(x[0])+'</span><strong>'+num(x[1])+'</strong><div class="health-track"><div class="health-fill" style="width:'+Math.min(100,x[1]/total*100)+'%"></div></div></div>').join("")+'<div class="relationship-summary"><span>'+esc(t("directMatches"))+": "+num(data.summary?.dropdownDirectMatches)+'</span><span>'+esc(t("agentMatches"))+": "+num(data.summary?.dropdownAgentMatches)+'</span></div>';
  }
  function renderVisits(visits){
    if(!visits.length){$("recentVisits").innerHTML='<div class="empty-chart">'+esc(t("noRecentVisits"))+'</div>';return;}
    const ar=state.language==="ar";
    const label=(en,arabic)=>ar?arabic:en;
    $("recentVisits").innerHTML=visits.map(v=>{
      const rows=[
        [label("Date","التاريخ"),v.date||date(v.scheduledAt)],
        [label("Time in","وقت الدخول"),v.timeIn],
        [label("Time out","وقت الخروج"),v.timeOut],
        [label("Sales agent","مندوب المبيعات"),v.salesAgent||v.createdBy],
        [label("Sales manager","مدير المبيعات"),v.salesManager],
        [label("Broker admin","مسؤول الشركة"),v.brokerAdmin],
        [label("Broker type","نوع الوسيط"),v.brokerType],
        [label("Activity","نوع النشاط"),v.type],
        [label("Request number","رقم الطلب"),v.requestNumber],
        [label("Project ID","كود المشروع"),v.projectId],
        [label("Check-in location","موقع الدخول"),v.locationIn],
        [label("Check-out location","موقع الخروج"),v.locationOut],
        [label("Email","البريد الإلكتروني"),v.email],
        [label("Duplicate","مكرر؟"),v.isDuplicate]
      ].filter(x=>x[1]!==null&&x[1]!==undefined&&String(x[1]).trim()!=="");
      return '<div class="recent-item orientation-record"><div><strong>'+esc(v.companyName||v.newCompanyName||t("unknown"))+'</strong><small>'+esc(v.date||date(v.scheduledAt))+' · '+esc(v.timeIn||"—")+'</small><div class="orientation-details">'+rows.map(x=>'<span><b>'+esc(x[0])+':</b> '+esc(x[1])+'</span>').join("")+'</div></div><span class="status-pill">'+esc(v.type||"Orientation")+'</span></div>';
    }).join("");
  }
  function populateRelations(relations){
    const select=$("relationshipFilter"),current=select.value;
    select.innerHTML='<option value="all">'+esc(t("allRelationships"))+'</option>'+relationKeys.filter(k=>Array.isArray(relations[k])&&relations[k].length).map(k=>'<option value="'+k+'">'+esc(t(k))+'</option>').join("");
    if(Array.from(select.options).some(o=>o.value===current))select.value=current;
  }
  function renderRelations(relations){
    const selected=$("relationshipFilter").value||"all";
    const rows=selected==="all"?relationKeys.flatMap(k=>(relations[k]||[]).map(x=>Object.assign({type:k},x))):(relations[selected]||[]);
    $("relationshipSummary").innerHTML='<span>'+esc(t("sourceData"))+': '+num(relationKeys.filter(k=>(relations[k]||[]).length).length)+' '+esc(t("relationships"))+'</span><span>'+num(rows.length)+' '+esc(t("recordsCount"))+'</span><span>'+esc(selected==="all"?t("allRelationships"):t(selected))+'</span>';
    $("relationshipRows").innerHTML=rows.length?rows.slice(0,250).map(x=>'<tr><td>'+esc(x.from)+'</td><td>'+esc(x.to)+'</td><td>'+num(x.count)+'</td></tr>').join(""):'<tr><td colspan="3">'+esc(t("noRelationships"))+'</td></tr>';
  }
  function statusLabel(v){return ({SCHEDULED:t("scheduled"),IN_PROGRESS:t("inProgress"),COMPLETED:t("completedStatus"),CANCELLED:t("cancelledStatus"),NO_SHOW:t("noShow")})[v]||v||t("unknown");}
  $("loginForm").addEventListener("submit",login);$("logoutBtn").addEventListener("click",logout);$("refreshBtn").addEventListener("click",()=>loadDashboard(true));$("periodFilter").addEventListener("change",()=>loadDashboard());$("companyFilter").addEventListener("change",()=>loadDashboard());$("relationshipFilter").addEventListener("change",()=>renderRelations(state.data?.relationships||{}));$("languageBtn").addEventListener("click",()=>setLanguage(state.language==="en"?"ar":"en"));
  setLanguage(state.language);
  if(state.token){showApp(state.user);api("/api/auth/me").then(result=>{state.user=result.user;showApp(result.user);return loadDashboard();}).catch(()=>logout());}
})();