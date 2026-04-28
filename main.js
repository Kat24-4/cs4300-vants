import { default as seagulls } from 'https://cbcdn.githack.com/charlieroberts/gulls/raw/branch/main/gulls.js'

const WORKGROUP_SIZE = 64,
      NUM_AGENTS = 256,
      DISPATCH_COUNT = [NUM_AGENTS/WORKGROUP_SIZE,1,1],
      GRID_SIZE = 2,
      STARTING_AREA = .3

const W = Math.round( window.innerWidth  / GRID_SIZE ),
      H = Math.round( window.innerHeight / GRID_SIZE )

const render_shader = seagulls.constants.vertex + `
struct Vant {
  pos: vec2f,
  dir: f32,
  flag: f32
}

@group(0) @binding(0) var<storage> pheromones: array<f32>;
@group(0) @binding(1) var<storage> render: array<f32>;
@group(0) @binding(2) var<storage> flags: array<u32>;

@fragment 
fn fs( @builtin(position) pos : vec4f ) -> @location(0) vec4f {
  let grid_pos = floor( pos.xy / ${GRID_SIZE}.);
  
  let pidx = grid_pos.y  * ${W}. + grid_pos.x;
  let p = pheromones[ u32(pidx) ];
  let v = render[ u32(pidx) ];
  let f = flags[ u32(pidx) ];

  // r0g0b1 = yellow, r0g1b1 = red, r0g1b0 = magenta
  // r1g1b0 = blue, r1g0b1 = green, r1g0b0 = cyan

  var r = 0.;
  var g = 0.;
  var b = 1.;

  if ( f == 1 ) {
    r = 0;
    g = 1;
    b = 0;
  } else if ( f == 2 ) {
    r = 1;
    g = 0;
    b = 0;
  }

  let out = select( vec3(p-r, p-g, p-b) , vec3(1.,0.,0.), v == 1. );
  
  return vec4f( out, 1. );
}`

const compute_shader =`
struct Vant {
  pos: vec2f,
  dir: f32,
  flag: f32
}

@group(0) @binding(0) var<storage, read_write> vants: array<Vant>;
@group(0) @binding(1) var<storage, read_write> pheremones: array<f32>;
@group(0) @binding(2) var<storage, read_write> render: array<f32>;
@group(0) @binding(3) var<storage, read_write> flags: array<u32>;

fn pheromoneIndex( vant_pos: vec2f ) -> u32 {
  let width = ${W}.;
  return u32( abs( vant_pos.y % ${H}. ) * width + vant_pos.x );
}

@compute
@workgroup_size(${WORKGROUP_SIZE},1,1)

fn cs(@builtin(global_invocation_id) cell:vec3u)  {
  let pi2   = ${Math.PI*2}; 
  var vant:Vant  = vants[ cell.x ];

  let pIndex    = pheromoneIndex( vant.pos );
  let pheromone = pheremones[ pIndex ];

  if ( (cell.x%2) == 0) {
    vant.flag = 1;
    flags[ pIndex ] = 1;
  } else if ( (cell.x%3) == 0) {
    vant.flag = 2;
    flags[ pIndex ] = 2;
  } else {
    flags[ pIndex ] = 0;  
  }

  // if pheromones were found
  if( pheromone != 0. ) {
    if ( vant.flag == 0 ) {
        vant.dir += -.25; // left
    } else if ( vant.flag == 1 ) {
        vant.dir += .0; // straight
    } else if ( vant.flag == 2 ) {
        vant.dir += .25; // right
    } else {
        vant.dir += .0;
    }

    pheremones[ pIndex ] = 0.;  // set pheromone flag

  }else{
    vant.dir += select(-.25,.25,vant.flag==0.); // turn 90 degrees counter-clockwise
    pheremones[ pIndex ] = 1.;  // unset pheromone flag

    if (vant.flag == 1 ) { // if straight lay down extra pheremones
        pheremones [ pIndex - 1 ] = 1;
        pheremones [ pIndex + 1 ] = 1;
    }
  }

  // calculate direction based on vant heading
  let dir = vec2f( sin( vant.dir * pi2 ), cos( vant.dir * pi2 ) );
  
  vant.pos = round( vant.pos + dir ); 

  vants[ cell.x ] = vant;
  
  // we'll look at the render buffer in the fragment shader
  // if we see a value of one a vant is there and we can color
  // it accordingly. in our JavaScript we clear the buffer on every
  // frame.
  render[ pIndex ] = 1.;
}`
 
const NUM_PROPERTIES = 4 // must be evenly divisble by 4!
const pheromones   = new Float32Array( W*H ) // hold pheromone data
const vants_render = new Float32Array( W*H ) // hold info to help draw vants
const vants        = new Float32Array( NUM_AGENTS * NUM_PROPERTIES ) // hold vant info
const flags        = new Uint32Array( W*H ) // hold flag for each vant 

const offset = .5 - STARTING_AREA / 2
for( let i = 0; i < NUM_AGENTS * NUM_PROPERTIES; i+= NUM_PROPERTIES ) {
  vants[ i ]   = Math.floor( (offset+Math.random()*STARTING_AREA) * W ) // x
  vants[ i+1 ] = Math.floor( (offset+Math.random()*STARTING_AREA) * H ) // y
  vants[ i+2 ] = 0 // direction 
  vants[ i+3 ] = Math.round( Math.random()  ) // vant behavior type 
}

const sg = await seagulls.init()
const pheromones_b = sg.buffer( pheromones )
const vants_b  = sg.buffer( vants )
const render_b = sg.buffer( vants_render )
const flags_b = sg.buffer( flags )

const render = await sg.render({
  shader: render_shader,
  data:[
    pheromones_b,
    render_b,
    flags_b
  ],
})

const compute = sg.compute({
  shader: compute_shader,
  data:[
    vants_b,
    pheromones_b,
    render_b,
    flags_b
  ],
  onframe() { render_b.clear() },
  dispatchCount:DISPATCH_COUNT
})

sg.run( compute, render )