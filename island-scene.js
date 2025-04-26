import * as THREE from "three"
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { RGBELoader } from "three/addons/loaders/RGBELoader.js"

// Global variables
let scene, camera, renderer, controls
let clock, mixer
let water, sunLight, pointLight
let moveForward = false,
  moveBackward = false,
  moveLeft = false,
  moveRight = false,
  canJump = false
const velocity = new THREE.Vector3()
const direction = new THREE.Vector3()
const objects = [] // For collision detection
let boatGroup // Group to control boat movement and rocking
let raycaster // For improved collision detection

// DOM elements
const loadingElement = document.getElementById("loading")
const infoElement = document.getElementById("info")

// Configuration 
const waterLevel = 0.2
const islandSize = 50
const playerHeight = 1.5
const boatInitialPosition = new THREE.Vector3(islandSize * 0.3, waterLevel - 0.1, islandSize * 0.4)
const gravity = 30.0 // Gravity strength
const jumpVelocity = 10.0 // Jump strength


// Models
const boatModel = "boat.glb" //https://sketchfab.com/3d-models/gislinge-viking-boat-01098ad7973647a9b558f41d2ebc5193
const treeModel = "tree.glb" //https://sketchfab.com/3d-models/realistic-palm-tree-4-free-917c18d6b2d04d33950dea6e20bc074f
const tModel = "tree1.glb"   //https://sketchfab.com/3d-models/washingtonia-robusta-palm-03-d63d13e51e1d4925b9eb6b984431762b
const houseModel = "house.glb"
const slumhouseModel = "slum.glb"  //https://sketchfab.com/3d-models/slum-house-e902e0af80804d01924387da6af8eecf

// Textures - all the textues are from https://www.freepik.com/
const sand = "sand.jpg"
const grass = "grass.jpg"
const rock = "rock.jpg"
const wood = "wood.jpg"
const waterNormal = "water.jpg"

// Skybox
//photos has been taken form https://github.com/dgreenheck/threejs-water-shader/blob/main/public/nx.png
const skyboxPaths = [
  "px.jpg", // (Positive X)
  "nx.jpg", //  (Negative X)
  "py.jpg", //  (Positive Y)
  "ny.jpg", //  (Negative Y)
  "pz.jpg", //  (Positive Z)
  "nz.jpg", //  (Negative Z)
]

// Loaders
const loadingManager = new THREE.LoadingManager()
const gltfLoader = new GLTFLoader(loadingManager)
const textureLoader = new THREE.TextureLoader(loadingManager)
const cubeTextureLoader = new THREE.CubeTextureLoader(loadingManager)
const rgbeLoader = new RGBELoader(loadingManager)

// Shader Definitions
// Advanced Water Shader (Vertex)
const waterVertexShader = `
    uniform float time;
    uniform sampler2D normalMap;
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
        vUv = uv;
        vec3 pos = position;
        
        // More complex wave effect with multiple frequencies
        float wave1 = sin(pos.x * 0.2 + time * 0.8) * cos(pos.z * 0.2 + time * 0.6) * 0.08;
        float wave2 = sin(pos.x * 0.4 + time * 1.2) * cos(pos.z * 0.3 + time * 1.0) * 0.05;
        float waveFactor = wave1 + wave2;
        
        pos.y += waveFactor;
        
        // Calculate normal for lighting
        vNormal = normalize(normalMatrix * normal);
        
        vec4 modelViewPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * modelViewPosition;
        vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;
    }
`

// Advanced Water Shader (Fragment)
const waterFragmentShader = `
    uniform sampler2D normalMap;
    uniform samplerCube envMap;
    uniform float time;
    uniform vec3 waterColor;
    uniform vec3 waterDeepColor;
    uniform float opacity;
    uniform vec3 cameraPos;
    uniform float normalScale;
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
        // Animated UVs for normal map
        vec2 uv = vUv;
        uv.x += time * 0.05;
        uv.y += time * 0.03;
        
        // Sample normal map and transform to world space
        vec3 normalFromMap = texture2D(normalMap, uv).rgb * 2.0 - 1.0;
        normalFromMap.xy *= normalScale;
        normalFromMap = normalize(normalFromMap);
        
        // Combine with base normal
        vec3 worldNormal = normalize(vNormal + normalFromMap);
        
        vec3 viewDirection = normalize(vWorldPosition - cameraPos);
        vec3 reflectVec = reflect(viewDirection, worldNormal);

        // Sample environment map for reflection with improved bias
        float reflectBias = 0.01;
        vec4 envColor = textureCube(envMap, reflectVec + worldNormal * reflectBias);

        // Enhanced Fresnel effect
        float fresnel = 0.02 + 0.98 * pow(1.0 - dot(-viewDirection, worldNormal), 5.0);
        
        // Depth-based color blending (shallow to deep water)
        float depth = clamp(1.0 - (cameraPos.y - vWorldPosition.y) * 0.1, 0.0, 1.0);
        vec3 baseWaterColor = mix(waterColor, waterDeepColor, depth);
        
        // Combine base water color with reflection
        vec3 finalColor = mix(baseWaterColor, envColor.rgb, fresnel);
        
        // Add subtle highlights based on normal
        float highlight = pow(max(0.0, dot(worldNormal, normalize(vec3(0.1, 1.0, 0.1)))), 32.0) * 0.5;
        finalColor += vec3(highlight);

        gl_FragColor = vec4(finalColor, opacity);
    }
`

// Initialization 
init()

function init() {
  clock = new THREE.Clock()
  raycaster = new THREE.Raycaster()

  // Scene Setup 
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x87ceeb) // Fallback background color
  scene.fog = new THREE.Fog(0x87ceeb, 50, 150) // Add fog for atmosphere

  // Camera Setup 
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
  camera.position.set(0, playerHeight + waterLevel + 5, 15) // Start above water level

  // Renderer Setup 
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.shadowMap.enabled = true // Enable shadows
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping // Improve lighting realism
  renderer.toneMappingExposure = 1.0
  document.body.appendChild(renderer.domElement)

  //  Controls (Pointer Lock for FPV) 
  controls = new PointerLockControls(camera, document.body)
  scene.add(controls.getObject()) // Add camera rig to scene

  // Event listeners for pointer lock
  infoElement.addEventListener("click", () => {
    if (!controls.isLocked) {
      // Only lock if not already locked
      controls.lock()
    }
  })
  controls.addEventListener("lock", () => {
    infoElement.style.display = "none"
  })
  controls.addEventListener("unlock", () => {
    infoElement.style.display = "block"
  })

  // Keyboard controls
  document.addEventListener("keydown", onKeyDown)
  document.addEventListener("keyup", onKeyUp)

  // Lighting 
  // Ambient light for overall illumination
  const ambientLight = new THREE.AmbientLight(0x607080, 0.8) // Soft ambient light
  scene.add(ambientLight)

  // Directional light (Sun)
  sunLight = new THREE.DirectionalLight(0xffffff, 3.0) // Increased intensity
  sunLight.position.set(50, 70, 30)
  sunLight.castShadow = true
  // Configure shadow properties for better quality
  sunLight.shadow.mapSize.width = 2048
  sunLight.shadow.mapSize.height = 2048
  sunLight.shadow.camera.near = 0.5
  sunLight.shadow.camera.far = 200
  sunLight.shadow.camera.left = -islandSize * 1.5
  sunLight.shadow.camera.right = islandSize * 1.5
  sunLight.shadow.camera.top = islandSize * 1.5
  sunLight.shadow.camera.bottom = -islandSize * 1.5
  scene.add(sunLight)
  scene.add(sunLight.target) // Target for the light

  // Point light (inside the house)
  pointLight = new THREE.PointLight(0xffaa00, 50, 30) // Color, Intensity, Distance
  pointLight.position.set(-5, waterLevel + 5, -5) // Initial position, will be updated when house loads
  pointLight.castShadow = true
  pointLight.visible = true // Initially visible
  scene.add(pointLight)

  //Skybox
  try {
    const skyboxTexture = cubeTextureLoader.load(
      skyboxPaths,
      () => {
        scene.background = skyboxTexture
        scene.environment = skyboxTexture // Use for reflections
        console.log("Skybox loaded.")
        // 
        if (water && water.material.uniforms.envMap) {
          water.material.uniforms.envMap.value = scene.environment
          water.material.needsUpdate = true
        }
      },
      undefined,
      (error) => {
        console.error("Error loading skybox:", error)
        scene.background = new THREE.Color(0x87ceeb) // Fallback color
      },
    )
  } catch (error) {
    console.error("Failed to initiate skybox loading:", error)
    scene.background = new THREE.Color(0x87ceeb) // Fallback color
  }

  // Terrain (Programmatic) 
  createTerrain()

  //  Water (Programmatic with Shader) 
  createWater()

  // Programmatic Elements 
  createRocks()
  createPier()

  //  Imported Models 
  loadBoat()
  loadTrees()
  loadt()
  loadHouse()
  loadslumhouse()
  // Loading Manager 
  setupLoadingManager()

  //  Handle Window Resize 
  window.addEventListener("resize", onWindowResize)
}

// Terrain Creation 
function createTerrain() {
  const islandGeometry = new THREE.PlaneGeometry(islandSize * 2, islandSize * 2, 100, 100)
  islandGeometry.rotateX(-Math.PI / 2) // Rotate plane to be horizontal
  const positionAttribute = islandGeometry.getAttribute("position")
  const vertex = new THREE.Vector3()

  // Create more interesting terrain with multiple noise frequencies
  for (let i = 0; i < positionAttribute.count; i++) {
    vertex.fromBufferAttribute(positionAttribute, i)
    const dist = Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z)
    const scale = Math.max(0, 1.0 - dist / (islandSize * 0.9)) // Fade height towards edges

    // Multi-frequency noise for more natural terrain
    const noise1 = Math.sin(vertex.x * 0.15 + vertex.z * 0.1) * 2.0
    const noise2 = Math.cos(vertex.z * 0.15 + vertex.x * 0.05) * 1.5
    const noise3 = Math.sin(vertex.x * 0.3 + vertex.z * 0.25) * 0.5

    const height = (noise1 + noise2 + noise3) * scale
    vertex.y = Math.max(waterLevel - 0.5, height) // Ensure island base is slightly below water
    positionAttribute.setY(i, vertex.y)
  }
  islandGeometry.computeVertexNormals() // Recalculate normals after displacement

  // Create a blend of sand and grass textures
  const sandTexture = textureLoader.load(sand)
  sandTexture.wrapS = THREE.RepeatWrapping
  sandTexture.wrapT = THREE.RepeatWrapping
  sandTexture.repeat.set(8, 8)

  const grassTexture = textureLoader.load(grass)
  grassTexture.wrapS = THREE.RepeatWrapping
  grassTexture.wrapT = THREE.RepeatWrapping
  grassTexture.repeat.set(8, 8)

  // Create a custom vertex color attribute for blending between textures
  const colors = new Float32Array(positionAttribute.count * 3)
  for (let i = 0; i < positionAttribute.count; i++) {
    vertex.fromBufferAttribute(positionAttribute, i)
    // Higher areas get more grass, lower areas get more sand
    const blendFactor = Math.min(1.0, Math.max(0.0, (vertex.y - waterLevel) / 2.0))
    colors[i * 3] = blendFactor // R channel stores blend factor
    colors[i * 3 + 1] = blendFactor // G channel
    colors[i * 3 + 2] = blendFactor // B channel
  }
  islandGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))

  // Custom material that blends between sand and grass based on height
  const islandMaterial = new THREE.MeshStandardMaterial({
    map: sandTexture,
    roughness: 0.8,
    metalness: 0.1,
    vertexColors: true,
  })

  // Add a second texture for grass and blend in the fragment shader
  islandMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.grassMap = { value: grassTexture }

    // Add the grass texture uniform
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
      uniform sampler2D grassMap;`,
    )

    // Modify the map sampling to blend between sand and grass
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#ifdef USE_MAP
        vec4 sandTexel = texture2D(map, vMapUv);
        vec4 grassTexel = texture2D(grassMap, vMapUv);
        vec4 texelColor = mix(sandTexel, grassTexel, vColor.r);
        diffuseColor *= texelColor;
      #endif`,
    )
  }

  const island = new THREE.Mesh(islandGeometry, islandMaterial)
  island.receiveShadow = true
  island.position.y = 0
  scene.add(island)
  objects.push(island)
}

// Water Creation
function createWater() {
  const waterGeometry = new THREE.PlaneGeometry(islandSize * 3, islandSize * 3, 50, 50)
  waterGeometry.rotateX(-Math.PI / 2)

  // Load normal map for water
  const normalMapTexture = textureLoader.load(waterNormal)
  normalMapTexture.wrapS = THREE.RepeatWrapping
  normalMapTexture.wrapT = THREE.RepeatWrapping
  normalMapTexture.repeat.set(5, 5)

  const waterMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0.0 },
      normalMap: { value: normalMapTexture },
      normalScale: { value: 0.3 },
      waterColor: { value: new THREE.Color(0x0077be) }, // Lighter blue for shallow water
      waterDeepColor: { value: new THREE.Color(0x003366) }, // Darker blue for deep water
      opacity: { value: 0.85 },
      envMap: { value: scene.environment || null },
      cameraPos: { value: camera.position },
    },
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
  })

  water = new THREE.Mesh(waterGeometry, waterMaterial)
  water.position.y = waterLevel
  water.receiveShadow = 
  scene.add(water)
}

// --- Rock Creation ---
function createRocks() {
  const rockTexture = textureLoader.load(rock)
  const rockMaterial = new THREE.MeshStandardMaterial({
    map: rockTexture,
    roughness: 0.9,
    metalness: 0.1,
    normalScale: new THREE.Vector2(1, 1),
  })

  // Create rocks with more variation
  for (let i = 0; i < 15; i++) {
    // Randomly choose between different rock shapes
    let rockGeometry
    const rockType = Math.floor(Math.random() * 3)
    const radius = Math.random() * 1.5 + 0.5

    switch (rockType) {
      case 0:
        rockGeometry = new THREE.SphereGeometry(radius, 16, 12)
        break
      case 1:
        rockGeometry = new THREE.DodecahedronGeometry(radius, 1)
        break
      case 2:
        rockGeometry = new THREE.OctahedronGeometry(radius, 1)
        break
    }

    // Deform the rock geometry for more natural look
    const rockPosAttr = rockGeometry.getAttribute("position")
    for (let j = 0; j < rockPosAttr.count; ++j) {
      const vert = new THREE.Vector3().fromBufferAttribute(rockPosAttr, j)
      vert.multiplyScalar(1.0 + (Math.random() + 0.1) * -0.1)
      rockPosAttr.setXYZ(j, vert.x, vert.y, vert.z)
    }
    rockGeometry.computeVertexNormals()

    const rock = new THREE.Mesh(rockGeometry, rockMaterial)

    // Place rocks with better distribution
    const angle = Math.random() * Math.PI * 3
    const dist = Math.random() * (islandSize * 0.7) + islandSize * 0.1
    rock.position.set(Math.cos(angle) * dist, waterLevel + radius * 0.5, Math.sin(angle) * dist)

    // Adjust height based on terrain (simplified)
    rock.position.y = Math.max(waterLevel + radius * 0.3, Math.random() * 0.2 + waterLevel)

    
    rock.castShadow = true
    rock.receiveShadow = true
    scene.add(rock)
    objects.push(rock)
  }
}

// Pier Creation 
function createPier() {
  const woodTexture = textureLoader.load(wood)
  woodTexture.wrapS = THREE.RepeatWrapping
  woodTexture.wrapT = THREE.RepeatWrapping
  woodTexture.repeat.set(1, 5)

  const pierMaterial = new THREE.MeshStandardMaterial({
    map: woodTexture,
    roughness: 0.7,
    metalness: 0.1,
  })

  // Create a more detailed pier with posts and planks
  const pierGroup = new THREE.Group()

  // Main deck
  const pierDeckGeo = new THREE.BoxGeometry(1.5, 0.1  , 11)
  const pierDeck = new THREE.Mesh(pierDeckGeo, pierMaterial)
  pierDeck.castShadow = true
  pierDeck.receiveShadow = true
  pierGroup.add(pierDeck)

  // Support posts
  const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 2, 8)
  for (let i = -4; i <= 4; i += 2) {
    const post1 = new THREE.Mesh(postGeo, pierMaterial)
    post1.position.set(-0.5, -1, i)
    post1.castShadow = true
    pierGroup.add(post1)

    const post2 = new THREE.Mesh(postGeo, pierMaterial)
    post2.position.set(0.5, -1, i)
    post2.castShadow = true
    pierGroup.add(post2)
  }

  // Railings
  const railingGeo = new THREE.BoxGeometry(0.1, 0.1, 10)
  const railing1 = new THREE.Mesh(railingGeo, pierMaterial)
  railing1.position.set(-0.7, 0.5, 0)
  railing1.castShadow = true
  pierGroup.add(railing1)

  const railing2 = new THREE.Mesh(railingGeo, pierMaterial)
  railing2.position.set(0.7, 0.5, 0)
  railing2.castShadow = true
  pierGroup.add(railing2)

  // Vertical posts for railings
  const railPostGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1)
  for (let i = -4.5; i <= 4.5; i += 1) {
    const railPost1 = new THREE.Mesh(railPostGeo, pierMaterial)
    railPost1.position.set(-0.7, 0.25, i)
    railPost1.castShadow = true
    pierGroup.add(railPost1)

    const railPost2 = new THREE.Mesh(railPostGeo, pierMaterial)
    railPost2.position.set(0.7, 0.25, i)
    railPost2.castShadow = true
    pierGroup.add(railPost2)
  }

  // Position the entire pier
  pierGroup.position.set(islandSize * 0.4 , waterLevel + 0.3, 0)
  scene.add(pierGroup)
  objects.push(pierGroup)
}

// Boat Loading 
function loadBoat() {
  boatGroup = new THREE.Group()

  // Position the boat at the edge of the island on the circular path
  const circleRadius = islandSize * -0.3
  boatGroup.position.set(circleRadius, waterLevel -1.5, 0.5)

  scene.add(boatGroup)

  gltfLoader.load(
    boatModel,
    (gltf) => {
      const boat = gltf.scene
      boat.scale.set(0.02, 0.02, 0.02)
      boat.rotation.y = Math.PI /4

      boat.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true

          // Improve boat materials if needed
          if (child.material) {
            child.material.roughness = 0.7
            child.material.metalness = 0.2
          }
        }
      })

      boatGroup.add(boat)
      objects.push(boatGroup)
      console.log("Boat model loaded.")

      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(boat)
        const action = mixer.clipAction(gltf.animations[0])
        action.play()
        console.log("Boat animation started.")
        boatGroup.userData.isRocking = true
      } else {
        boatGroup.userData.isRocking = true
      }
    },
    undefined,
    (error) => {
      console.error("Error loading boat model:", error)
      // Create a more detailed placeholder boat
      createPlaceholderBoat()
    },
  )
}

// Tree Loading 
function loadTrees() {
  // Load multiple trees with different positions and scales
  const treePositions = [
    { pos: new THREE.Vector3(islandSize * 0.59, waterLevel - 0.1, -islandSize * -0.1), scale: 0.38 }, 
    { pos: new THREE.Vector3(-islandSize * 0.6, waterLevel -0.1, islandSize * +0.1), scale: 0.9 },
    { pos: new THREE.Vector3(islandSize * -0.1, waterLevel -0.1, islandSize * +0.2), scale: 1.0 },
    { pos: new THREE.Vector3(islandSize * -0.5  , waterLevel -0.5, islandSize * 0.1), scale: 2.2 },
  ]

  treePositions.forEach((treeDef, index) => {
    gltfLoader.load(
      treeModel,
      (gltf) => {
        const tree = gltf.scene
        tree.scale.set(treeDef.scale, treeDef.scale, treeDef.scale)
        tree.position.copy(treeDef.pos)

        // Add some random rotation for variety
        tree.rotation.y = Math.random() * Math.PI * 2

        tree.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
        })

        scene.add(tree)
        objects.push(tree)
        console.log(`Tree ${index + 1} loaded.`)
      },
      undefined,
      (error) => {
        console.error(`Error loading tree ${index + 1}:`, error)
        createPlaceholderTree(treeDef.pos, treeDef.scale)
      },
    )
  })
}

function loadt() {
  // Load multiple trees with different positions and scales
  const tPositions = [
    { pos: new THREE.Vector3(-islandSize * 0.2, waterLevel -0.15, -islandSize * 0.6), scale: 1.9 },
    { pos: new THREE.Vector3(islandSize * 0.45, waterLevel - 0.1, -islandSize * +0.2), scale: 1.0 }, 
    { pos: new THREE.Vector3(islandSize * 0.5, waterLevel -0.1, islandSize * +0.1), scale: 0.1 },
   // { pos: new THREE.Vector3(islandSize * -0.1, waterLevel -0.1, islandSize * +0.2), scale: 1.0 },
  ]

  tPositions.forEach((tDef, index) => {
    gltfLoader.load(
      tModel,
      (gltf) => {
        const t = gltf.scene
        t.scale.set(tDef.scale, tDef.scale, tDef.scale)
        t.position.copy(tDef.pos)

        // Add some random rotation for variety
        t.rotation.y = Math.random() * Math.PI * 4

        t.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
        })

        scene.add(t)
        objects.push(t)
        console.log(`t ${index + 1} loaded.`)
      },
      undefined,
      (error) => {
        console.error(`Error loading tree ${index + 1}:`, error)
        createPlaceholderT(tDef.pos, tDef.scale)
      },
    )
  })
}

// House Loading 
function loadHouse() {
  gltfLoader.load(
    houseModel,
    (gltf) => {
      const house = gltf.scene
      house.scale.set(1, 1, 1)
      house.position.set(islandSize * +0.4, waterLevel +1, islandSize * 0)

      // Calculate rotation to face initial camera position
      const cameraPos = new THREE.Vector3(0, playerHeight + waterLevel + 2, 10) // Initial camera position
      const direction = new THREE.Vector3().subVectors(cameraPos, house.position).normalize()
      const angle = Math.atan2(direction.x, direction.z)
      house.rotation.y = angle + Math.PI// Rotate to face camera

      // Update point light position to match house
      pointLight.position.set(house.position.x, house.position.y + 1, house.position.z)

      house.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true
        }
      })

      scene.add(house)
      objects.push(house)
      console.log("House model loaded.")
    },
    undefined,
    (error) => {
      console.error("Error loading house model:", error)
      createPlaceholderHouse()
    },
  )
}


// Slumhouse Loading 
function loadslumhouse() {
  gltfLoader.load(
    slumhouseModel,
    (gltf) => {
      const slumhouse = gltf.scene
      slumhouse.scale.set(1, 1, 1)
      slumhouse.position.set(islandSize * 0.5, waterLevel +0.15, islandSize * 0.12)

      // Calculate rotation to face initial camera position + 180 degrees
      const cameraPos = new THREE.Vector3(0, playerHeight + waterLevel + 2, 10)
      const direction = new THREE.Vector3().subVectors(cameraPos, slumhouse.position).normalize()
      const angle = Math.atan2(direction.x, direction.z)
      slumhouse.rotation.y = angle + Math.PI /2 // Rotate to face camera

      // Update point light position to match slumhouse
      pointLight.position.set(slumhouse.position.x, slumhouse.position.y + 1, slumhouse.position.z)

      slumhouse.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true
        }
      })

      scene.add(slumhouse)
      objects.push(slumhouse)
      console.log("Slumhouse model loaded.")
    },
    undefined,
    (error) => {
      console.error("Error loading slumhouse model:", error)
      createPlaceholderHouse()
    },
  )
}

// Loading Manager Setup 
function setupLoadingManager() {
  loadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
    loadingElement.style.display = "block"
    loadingElement.textContent = `Loading: ${itemsLoaded} / ${itemsTotal}`
  }

  loadingManager.onLoad = () => {
    loadingElement.style.display = "none"
    if (water && scene.environment) {
      water.material.uniforms.envMap.value = scene.environment
      water.material.needsUpdate = true
    }
    animate() // Start the animation loop after everything is loaded
  }

  loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
    loadingElement.textContent = `Loading: ${itemsLoaded} / ${itemsTotal}`
  }

}

// Event Handlers 
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

function onKeyDown(event) {
  switch (event.code) {
    case "KeyW":
      moveForward = true
      break
    case "KeyA":
      moveLeft = true
      break
    case "KeyS":
      moveBackward = true
      break
    case "KeyD":
      moveRight = true
      break
    case "Space":
      if (canJump) {
        velocity.y = jumpVelocity
        canJump = false
      }
      break
    case "KeyL":
      pointLight.visible = !pointLight.visible
      break // Toggle light
    case "KeyT":
      // Toggle time of day (simple day/night cycle)
      if (sunLight.intensity > 1.0) {
        // Switch to night
        sunLight.intensity = 0.3
        scene.background = new THREE.Color(0x0a1a2a) // Dark blue night sky
        scene.fog.color.set(0x0a1a2a)
      } else {
        // Switch to day
        sunLight.intensity = 3.0
        if (scene.environment) {
          scene.background = scene.environment
        } else {
          scene.background = new THREE.Color(0x87ceeb)
        }
        scene.fog.color.set(0x87ceeb)
      }
      break
  }
}

function onKeyUp(event) {
  switch (event.code) {
    case "KeyW":
      moveForward = false
      break
    case "KeyA":
      moveLeft = false
      break
    case "KeyS":
      moveBackward = false
      break
    case "KeyD":
      moveRight = false
      break
  }
}

// Collision Detection 
function checkCollisions() {
  // Cast a ray downward to detect ground
  raycaster.ray.origin.copy(controls.getObject().position)
  raycaster.ray.direction.set(0, -1, 0)

  const intersections = raycaster.intersectObjects(objects, true)
  const onObject = intersections.length > 0 && intersections[0].distance < 2

  if (onObject) {
    velocity.y = Math.max(0, velocity.y)
    canJump = true

    // Adjust player height based on terrain
    if (intersections[0].distance < playerHeight) {
      controls.getObject().position.y = intersections[0].point.y + playerHeight
    }
  }

  // Simple collision detection for objects in front of player
  const playerDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  raycaster.ray.origin.copy(controls.getObject().position)
  raycaster.ray.direction.copy(playerDirection)

  const frontIntersections = raycaster.intersectObjects(objects, true)
  if (frontIntersections.length > 0 && frontIntersections[0].distance < 1) {
    // Prevent movement if too close to an object
    velocity.x = 0
    velocity.z = 0
  }
}

// Animation Loop 
function animate() {
  requestAnimationFrame(animate)

  const delta = clock.getDelta()
  const time = clock.getElapsedTime()

  // Check for collisions
  checkCollisions()

  // Update FPV Controls movement with improved physics
  if (controls.isLocked === true) {
    // Apply gravity
    velocity.y -= gravity * delta

    // Damping
    velocity.x -= velocity.x * 10.0 * delta
    velocity.z -= velocity.z * 10.0 * delta

    // Calculate movement direction
    direction.z = Number(moveForward) - Number(moveBackward)
    direction.x = Number(moveRight) - Number(moveLeft)
    direction.normalize()

    // Apply movement forces
    if (moveForward || moveBackward) velocity.z -= direction.z * 40.0 * delta
    if (moveLeft || moveRight) velocity.x -= direction.x * 40.0 * delta

    // Apply movement
    controls.moveRight(-velocity.x * delta)
    controls.moveForward(-velocity.z * delta)

    // Apply vertical movement (gravity/jumping)
    controls.getObject().position.y += velocity.y * delta

    // Prevent falling below water
    if (controls.getObject().position.y < waterLevel + playerHeight) {
      velocity.y = 0
      controls.getObject().position.y = waterLevel + playerHeight
      canJump = true
    }
  }

  // Update Animations 
  // 1. Water shader time uniform
  if (water) {
    water.material.uniforms.time.value = time
    water.material.uniforms.cameraPos.value.copy(camera.position)
  }

  // 2. Boat Animation (Movement + Rocking)
  if (boatGroup && boatGroup.userData.isRocking) {
    // Programmatic Rocking (applied to the group)
    boatGroup.rotation.z = Math.sin(time * 1.5) * 0.03 // Rock side to side
    boatGroup.rotation.x = Math.cos(time * 1.0) * 0.02 // Rock front to back
    boatGroup.position.y = boatInitialPosition.y + Math.sin(time * 1.2) * 0.05 // Bob up and down

    // Replace the linear movement with circular movement around the island
    const circleRadius = islandSize * 1.2 // Distance from island center
    const circleSpeed = 0.2 // Speed of rotation

    // Calculate position on circular path
    boatGroup.position.x = Math.cos(time * circleSpeed) * circleRadius
    boatGroup.position.z = Math.sin(time * circleSpeed) * circleRadius

    // Make boat face the direction of movement
    boatGroup.rotation.y =
      Math.atan2(
        Math.cos(time * circleSpeed + 0.05) - Math.cos(time * circleSpeed),
        Math.sin(time * circleSpeed + 0.05) - Math.sin(time * circleSpeed),
      ) +
      Math.PI / 4

    // Update animation mixer if it exists
    if (mixer) {
      mixer.update(delta)
    }
  }

  // 3. Animate point light for flickering effect
  if (pointLight.visible) {
    pointLight.intensity = 50 + Math.sin(time * 10) * 5 // Subtle flickering
  }

  renderer.render(scene, camera)
}
