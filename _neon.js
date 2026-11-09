require('./tools/_env');
['data','stat_data','skills','gauge','stats','cubes','specials','engine'].forEach(f => { try { require('./js/'+f+'.js'); } catch(e){} });
Object.assign(global, window);
var C = window.CHARACTERS, by = {};
C.forEach(c => { if (!by[c.name]) by[c.name] = c; });
function run(names) {
  var t = names.map(n => by[n]);
  var r = window.Engine.run(t, t, { seed: 5, arenaMode: 'c' });
  var b = r.bursts.filter(x => x.side === 'A');
  var neon = r.teams.A.filter(u => u.name.indexOf('ネオン') >= 0)[0];
  return { first3: b.filter(x => x.stage === 'B3')[0], burstCount: b.length,
           dmg: neon ? Math.round(neon.damageDealt) : 0,
           total: Math.round(r.teams.A.reduce((s,u)=>s+u.damageDealt,0)) };
}
console.log('with Neon :', JSON.stringify(run(['モラン','ルマニ','ネオン：ビジョンアイ','ノア','ジャッカル'])));
console.log('with Emilia:', JSON.stringify(run(['モラン','ルマニ','エミリア','ノア','ジャッカル'])));
