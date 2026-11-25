export function ReportSummary({score,total}:{score:number|null;total:number}){
 return <div className="report-summary">
  <div className="report-score" aria-label={score===null?"No score":`Top match fit: ${score} out of 100`}>
   <strong aria-hidden="true">{score??"—"}</strong><span aria-hidden="true">/ 100</span>
  </div>
  <div><div className="section-kicker">TOP MATCH FIT</div><h3>{total?`${total} ranked ${total===1?"opportunity":"opportunities"}`:"No ranked opportunities"}</h3>
   <p className="meta">The highest fit score in this report. It’s not a probability of funding or an eligibility decision.</p>
  </div>
 </div>;
}
