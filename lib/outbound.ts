const maxActive=8;
const maxQueued=80;
const queue:{start:()=>void;timer:ReturnType<typeof setTimeout>}[]=[];
let active=0;

export async function outbound<T>(run:()=>Promise<T>):Promise<T>{
 if(active<maxActive)active++;
 else{
  if(queue.length>=maxQueued)throw new Error("Source fetch queue is full");
  await new Promise<void>((resolve,reject)=>{
   const ticket={start:resolve,timer:setTimeout(()=>{
    queue.splice(queue.indexOf(ticket),1);
    reject(new Error("Timed out waiting for a source fetch slot"));
   },6000)};
   queue.push(ticket);
  });
 }
 try{return await run();}
 finally{
  const next=queue.shift();
  if(next){clearTimeout(next.timer);next.start();}
  else active--;
 }
}
