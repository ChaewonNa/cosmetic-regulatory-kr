type Filter={op:'eq'|'in'|'is';column:string;value:unknown};
type Order={column:string;ascending:boolean};
type Result<T=any>={data:T;error:{message:string}|null;count?:number|null};

class AzureQuery implements PromiseLike<Result<any>>{
  private action:'select'|'insert'|'update'|'delete'='select';
  private payload:unknown=null;
  private columns='*';
  private filters:Filter[]=[];
  private orders:Order[]=[];
  private rowLimit:number|null=null;
  private singleFlag=false;
  private countMode:string|null=null;
  private head=false;

  constructor(private table:string){}
  select(columns='*',options?:{count?:string;head?:boolean}){this.columns=columns||'*';this.countMode=options?.count||null;this.head=Boolean(options?.head);return this}
  insert(payload:unknown){this.action='insert';this.payload=payload;return this}
  update(payload:unknown){this.action='update';this.payload=payload;return this}
  delete(){this.action='delete';return this}
  eq(column:string,value:unknown){this.filters.push({op:'eq',column,value});return this}
  in(column:string,value:unknown[]){this.filters.push({op:'in',column,value});return this}
  is(column:string,value:unknown){this.filters.push({op:'is',column,value});return this}
  order(column:string,options?:{ascending?:boolean}){this.orders.push({column,ascending:options?.ascending!==false});return this}
  limit(v:number){this.rowLimit=v;return this}
  maybeSingle(){this.singleFlag=true;return this.execute()}
  single(){this.singleFlag=true;return this.execute()}

  private async execute():Promise<Result<any>>{
    try{
      const r=await fetch('/api/data',{
        method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({table:this.table,action:this.action,payload:this.payload,columns:this.columns,filters:this.filters,orders:this.orders,limit:this.rowLimit,single:this.singleFlag,count:this.countMode,head:this.head}),
      });
      const b=await r.json().catch(()=>({}));
      if(!r.ok)return{data:null,error:{message:b?.error||`Request failed (${r.status})`},count:b?.count??null};
      return{data:b?.data??null,error:null,count:b?.count??null};
    }catch(e){
      return{data:null,error:{message:e instanceof Error?e.message:'Azure request failed'},count:null};
    }
  }

  then<TResult1=Result<any>,TResult2=never>(f?:((v:Result<any>)=>TResult1|PromiseLike<TResult1>)|null,r?:((reason:any)=>TResult2|PromiseLike<TResult2>)|null){return this.execute().then(f,r)}
}

class AzureDataClient{
  from(table:string){return new AzureQuery(table)}
  async rpc(name:string,args:Record<string,unknown>={}){
    try{
      const r=await fetch('/api/rpc',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});
      const b=await r.json().catch(()=>({}));
      return r.ok?{data:b?.data??null,error:null}:{data:null,error:{message:b?.error||`Request failed (${r.status})`}};
    }catch(e){
      return{data:null,error:{message:e instanceof Error?e.message:'Azure RPC failed'}};
    }
  }
}

export const azureData=new AzureDataClient();
