// Mapbox 初始化
mapboxgl.accessToken = 'pk.eyJ1IjoiY2h0MTk5OCIsImEiOiJjbTZzMHR3a2UwMmU4Mmpxdm9vbm8zdDBsIn0.sS9cb0C04bji7VbyKL6Bzw';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v9',
  center: [-0.1278, 51.5074],
  zoom: 10
});

map.addControl(new mapboxgl.NavigationControl());


let londonBoundary = null;

function loadLondonBoundary() {
  fetch('./data/LSOA_21.geojson')
    .then(res => res.json())
    .then(geojson => {
      const combined = turf.combine(geojson);
      londonBoundary = combined.features[0]; // MultiPolygon
    });
}

loadLondonBoundary();

// Removed the TimeSelectControl class and its addition to map controls

// POI 分类颜色与映射
const categoryColors = {
  shop: '#2166AC',
  food: '#f4a582',
  health: '#b2182b',
  leisure: '#d1e5f0'
};

const poiTypes = {
  supermarket: 'shop',
  convenience: 'shop',
  mall: 'shop',
  marketplace: 'shop',
  fast_food: 'food',
  cafe: 'food',
  bar: 'food',
  hospital: 'health',
  clinic: 'health',
  pharmacy: 'health',
  park: 'leisure',
  sports_centre: 'leisure',
  fitness_centre: 'leisure'
};

// 全局变量
let poiData = null;
let postcodeMarker = null;
let searchMarker = null;

// 加载 POI
function loadPOIData() {
  fetch('./data/poi_london.geojson')
    .then(res => res.json())
    .then(data => {
      console.log("Original POI count:", data.features.length);
      data.features = data.features.filter(f => {
        const tags = f.properties || {};
        const type = tags.shop || tags.amenity || tags.leisure;
        if (tags.amenity === 'bus_station') return false;
        if (['station', 'subway_entrance'].includes(tags.railway)) return false;
        if (!poiTypes[type]) return false;
        f.properties.category = poiTypes[type];
        f.properties.type = type;
        f.properties.name = tags.name || '(Unnamed)';
        return true;
      });

      // 过滤：仅保留在 londonBoundary 内部的 POI
      if (londonBoundary) {
        data.features = data.features.filter(f => turf.booleanPointInPolygon(f, londonBoundary));
      }
      console.log("Filtered POI count:", data.features.length);

      poiData = data;

      const categories = ['shop', 'food', 'health', 'leisure'];
      categories.forEach(cat => {
        const filteredPOI = data.features.filter(f => f.properties.category === cat);
        
        map.addSource(`pois-${cat}`, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: filteredPOI },
          cluster: true,
          clusterRadius: 50
        });
        
        map.addLayer({
          id: `clusters-${cat}`,
          type: 'circle',
          source: `pois-${cat}`,
          paint: {
            'circle-color': categoryColors[cat],
            'circle-radius': ['step', ['get', 'point_count'], 15, 20, 20, 50, 25],
            'circle-opacity': 1
          }
        });

        map.addLayer({
          id: `unclustered-${cat}`,
          type: 'symbol',
          source: `pois-${cat}`,
          filter: ['!', ['has', 'point_count']],
          layout: {
            'icon-image': ['get', 'type'],
            'icon-size': 1.2,
            'icon-allow-overlap': true,
            'text-field': ['get', 'name'],
            'text-size': 11,
            'text-offset': [0, 1.2],
            'text-anchor': 'top'
          }
        });
      });

      // 添加 cluster-count layer for all clusters combined
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'pois-shop', // Use one source for cluster counts display
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 12
        },
        paint: {
          'text-color': '#fff'
        }
      });

      // 缩放切换聚合/单点
      map.on('zoom', () => {
        const z = map.getZoom();
        const vis = z >= 13 ? 'none' : 'visible';
        categories.forEach(cat => {
          map.setLayoutProperty(`clusters-${cat}`, 'visibility', vis);
        });
        map.setLayoutProperty('cluster-count', 'visibility', vis);
        categories.forEach(cat => {
          map.setLayoutProperty(`unclustered-${cat}`, 'visibility', z >= 13 ? 'visible' : 'none');
        });
      });

      map.on('click', 'unclustered-shop', e => {
        const f = e.features[0];
        const html = `<b>${f.properties.name}</b><br>Type: ${f.properties.type}`;
        new mapboxgl.Popup().setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
      });
      map.on('click', 'unclustered-food', e => {
        const f = e.features[0];
        const html = `<b>${f.properties.name}</b><br>Type: ${f.properties.type}`;
        new mapboxgl.Popup().setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
      });
      map.on('click', 'unclustered-health', e => {
        const f = e.features[0];
        const html = `<b>${f.properties.name}</b><br>Type: ${f.properties.type}`;
        new mapboxgl.Popup().setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
      });
      map.on('click', 'unclustered-leisure', e => {
        const f = e.features[0];
        const html = `<b>${f.properties.name}</b><br>Type: ${f.properties.type}`;
        new mapboxgl.Popup().setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
      });

      // Cluster click for each category
      categories.forEach(cat => {
        map.on('click', `clusters-${cat}`, e => {
          const clusterId = e.features[0].properties.cluster_id;
          map.getSource(`pois-${cat}`).getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return;
            map.easeTo({ center: e.features[0].geometry.coordinates, zoom: zoom });
          });
        });
      });
    });
}

// 步行等时圈 + 统计
async function searchByPostcode(postcode, duration = 600) {
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${postcode}`);
    const resJson = await res.json();
    if (!resJson.result) {
      alert('❌ Postcode not found. Please input a valid UK postcode.');
      return;
    }
    console.log("Postcode lookup result:", resJson);
    const { latitude, longitude } = resJson.result;

    const isoRes = await fetch(`https://api.openrouteservice.org/v2/isochrones/foot-walking?api_key=5b3ce3597851110001cf62483837ef5a171e432fa95123a6dc1bf175`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [[longitude, latitude]], range: [duration] })
    });
    const isoJson = await isoRes.json();
    console.log("Isochrone result:", isoJson);
    const area = isoJson.features[0];
    const counts = { shop: 0, food: 0, health: 0, leisure: 0 };

    poiData.features.forEach(poi => {
      const pt = turf.point(poi.geometry.coordinates);
      if (turf.booleanPointInPolygon(pt, area)) counts[poi.properties.category]++;
    });

    if (map.getSource('isochrone')) {
      map.getSource('isochrone').setData(area);
    } else {
      map.addSource('isochrone', { type: 'geojson', data: area });
      map.addLayer({
        id: 'isochrone-layer',
        type: 'fill',
        source: 'isochrone',
        paint: {
          'fill-color': '#f4623a',
          'fill-opacity': 0.25,
          'fill-outline-color': '#f4623a'
        }
      });
    }

    if (postcodeMarker) postcodeMarker.remove();
    postcodeMarker = new mapboxgl.Marker().setLngLat([longitude, latitude]).addTo(map);

    const popupContent = `
      <b>Postcode: ${postcode}</b><br>
      🛍️ Shops: ${counts.shop}<br>
      🍔 Food: ${counts.food}<br>
      🏥 Health: ${counts.health}<br>
      🌿 Leisure: ${counts.leisure}
    `;
    new mapboxgl.Popup().setLngLat([longitude, latitude]).setHTML(popupContent).addTo(map);
    map.easeTo({ center: [longitude, latitude], zoom: 13 });

  } catch (e) {
    alert('Postcode not found or ORS error.');
    console.error(e);
  }
}

map.on('load', () => {
  map.addSource('lsoa', {
    type: 'geojson',
    data: './data/LSOA_21.geojson'
  });
  map.addLayer({
    id: 'lsoa-boundary',
    type: 'line',
    source: 'lsoa',
    paint: {
      'line-color': '#444',
      'line-width': 1.5,
      'line-opacity': 0.5
    }
  });
  map.addLayer({
    id: 'lsoa-fill',
    type: 'fill',
    source: 'lsoa',
    layout: {},
    paint: {
      'fill-color': '#000000',
      'fill-opacity': 0
    }
  }, 'clusters-shop');

  map.addSource('highlighted-lsoa', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'highlighted-lsoa-layer',
    type: 'fill',
    source: 'highlighted-lsoa',
    paint: {
      'fill-color': '#f4623a',
      'fill-opacity': 0.25
    }
  });

  map.on('mouseenter', 'lsoa-boundary', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'lsoa-boundary', () => {
    map.getCanvas().style.cursor = '';
  });

  // 新的点击监听逻辑：点击地图任意处，检测是否在LSOA区域内
  map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ['lsoa-fill']
    });
    if (!features.length) {
      // 点击空白处清除高亮和 popup
      map.getSource('highlighted-lsoa').setData({
        type: 'FeatureCollection',
        features: []
      });
      return;
    }

    const feature = features[0];
    const polygon = {
      type: 'Feature',
      geometry: feature.geometry
    };

    map.getSource('highlighted-lsoa').setData({
      type: 'FeatureCollection',
      features: [polygon]
    });

    const counts = { shop: 0, food: 0, health: 0, leisure: 0 };

    if (!poiData || !polygon) return;

    const inside = poiData.features.filter(poi =>
      turf.booleanPointInPolygon(turf.point(poi.geometry.coordinates), polygon)
    );

    inside.forEach(poi => {
      const cat = poi.properties.category;
      if (counts[cat] !== undefined) counts[cat]++;
    });

    const html = `
      <b>${feature.properties.LSOA21NM}</b><br>
      🛍️ Shops: ${counts.shop}<br>
      🍔 Food: ${counts.food}<br>
      🏥 Health: ${counts.health}<br>
      🌿 Leisure: ${counts.leisure}
    `;

    new mapboxgl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);
  });

  const iconList = [
    'supermarket', 'convenience', 'mall', 'marketplace',
    'fast_food', 'cafe', 'bar',
    'hospital', 'clinic', 'pharmacy',
    'park', 'sports_centre', 'fitness_centre'
  ];
  let iconsLoaded = 0;

  iconList.forEach(name => {
    map.loadImage(`./icon/${name}.png`, (error, image) => {
      if (error) {
        console.warn(`Icon ${name}.png not loaded`);
        iconsLoaded++;
        if (iconsLoaded === iconList.length) {
          loadPOIData();
        }
        return;
      }
      if (!map.hasImage(name)) {
        map.addImage(name, image);
      }
      iconsLoaded++;
      if (iconsLoaded === iconList.length) {
        loadPOIData();
      }
    });
  });

  // loadPOIData();  // 注释掉此行，避免图标未加载就添加图层

  setTimeout(() => {
    if (!poiData) {
      console.warn("Forcing POI load due to timeout fallback");
      loadPOIData();
    }
  }, 3000);

  // 添加自定义图层控制UI
  const infoPanel = document.createElement('div');
  infoPanel.className = 'info';
  infoPanel.innerHTML = `
    <details open>
      <summary><b>What POIs to show?</b></summary>
      <label><input type="checkbox" checked data-layer="clusters-shop"> 🛍️ Shop</label><br>
      <label><input type="checkbox" checked data-layer="clusters-food"> 🍔 Food</label><br>
      <label><input type="checkbox" checked data-layer="clusters-health"> 🏥 Health</label><br>
      <label><input type="checkbox" checked data-layer="clusters-leisure"> 🌿 Leisure</label><br>
    </details>
    <button id="checkSourceBtn">Check Source</button>
    <div id="sourceInfo" style="display:none; margin-top:5px;">
      <small>
        <a href="https://api.openrouteservice.org/" target="_blank">OpenRouteService</a><br>
        <a href="https://postcodes.io/" target="_blank">UK Postcodes API</a>
      </small>
    </div>
  `;
  infoPanel.style.position = 'absolute';
  infoPanel.style.top = '10px';
  infoPanel.style.left = '10px';
  infoPanel.style.padding = '10px';
  infoPanel.style.background = '#fff';
  infoPanel.style.borderRadius = '6px';
  infoPanel.style.boxShadow = '0 0 6px rgba(0,0,0,0.2)';
  infoPanel.style.fontSize = '14px';
  document.body.appendChild(infoPanel);

  // 创建组合搜索栏（含 geocoder + duration + apply）
  const searchPanel = document.createElement('div');
  searchPanel.id = 'custom-search-panel';
  searchPanel.style.position = 'absolute';
  searchPanel.style.top = '20px';
  searchPanel.style.right = '20px';
  searchPanel.style.zIndex = '999';
  searchPanel.style.backgroundColor = '#fff';
  searchPanel.style.padding = '12px';
  searchPanel.style.borderRadius = '8px';
  searchPanel.style.boxShadow = '0 0 6px rgba(0,0,0,0.15)';
  searchPanel.innerHTML = `
    <div id="geocoder-container" style="margin-bottom: 10px;"></div>
    <select id="durationSelect" style="width: 100%; padding: 6px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #ccc;">
      <option value="300">5 minutes</option>
      <option value="600" selected>10 minutes</option>
      <option value="900">15 minutes</option>
      <option value="1200">20 minutes</option>
    </select>
    <button id="applyIsoBtn" style="width: 100%; padding: 8px; background-color: #f4623a; color: #fff; border: none; border-radius: 6px; font-weight: bold;">
      Apply
    </button>
  `;
  document.body.appendChild(searchPanel);

  // 挂载 geocoder 控件到容器
  const geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    placeholder: 'Enter a postcode',
    mapboxgl: mapboxgl,
    marker: false,
    language: 'en',
    bbox: [-9.0, 49.75, 2.01, 61.01]
  });
  document.getElementById('geocoder-container').appendChild(geocoder.onAdd(map));

  // 监听 geocoder 结果
  let latestCoords = null;
  geocoder.on('result', function (e) {
    const [lon, lat] = e.result.center;
    latestCoords = [lon, lat];
    if (searchMarker) searchMarker.remove();
    searchMarker = new mapboxgl.Marker({ color: '#f4623a' })
      .setLngLat([lon, lat])
      .setPopup(new mapboxgl.Popup({ offset: 25 }).setText(e.result.place_name))
      .addTo(map);
    map.easeTo({ center: [lon, lat], zoom: 13 });
  });

  // 监听 Apply 按钮
  document.getElementById('applyIsoBtn').addEventListener('click', async () => {
    const duration = parseInt(document.getElementById('durationSelect').value);
    if (!latestCoords) {
      alert('Please enter a postcode first.');
      return;
    }
    const [lon, lat] = latestCoords;
    const isoRes = await fetch(`https://api.openrouteservice.org/v2/isochrones/foot-walking?api_key=5b3ce3597851110001cf62483837ef5a171e432fa95123a6dc1bf175`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [[lon, lat]], range: [duration] })
    });
    const isoJson = await isoRes.json();
    const area = isoJson.features[0];
    const counts = { shop: 0, food: 0, health: 0, leisure: 0 };
    poiData.features.forEach(poi => {
      const pt = turf.point(poi.geometry.coordinates);
      if (turf.booleanPointInPolygon(pt, area)) counts[poi.properties.category]++;
    });
    if (map.getSource('isochrone')) {
      map.getSource('isochrone').setData(area);
    } else {
      map.addSource('isochrone', { type: 'geojson', data: area });
      map.addLayer({
        id: 'isochrone-layer',
        type: 'fill',
        source: 'isochrone',
        paint: {
          'fill-color': '#f4623a',
          'fill-opacity': 0.25,
          'fill-outline-color': '#f4623a'
        }
      });
    }
    const popupContent = `
      <b>Within ${duration / 60} minutes walk</b><br>
      🛍️ Shops: ${counts.shop}<br>
      🍔 Food: ${counts.food}<br>
      🏥 Health: ${counts.health}<br>
      🌿 Leisure: ${counts.leisure}
    `;
    new mapboxgl.Popup().setLngLat([lon, lat]).setHTML(popupContent).addTo(map);
  });

  infoPanel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', e => {
      const layerId = e.target.getAttribute('data-layer');
      const vis = e.target.checked ? 'visible' : 'none';
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', vis);
      }
    });
  });

  // Add toggle event for Check Source button
  infoPanel.querySelector('#checkSourceBtn')?.addEventListener('click', () => {
    const info = infoPanel.querySelector('#sourceInfo');
    info.style.display = info.style.display === 'none' ? 'block' : 'none';
  });

  // Style the check source button
  const btnStyle = document.createElement('style');
  btnStyle.textContent = `
    .info button {
      background-color: #f4623a;
      color: #fff;
      border: none;
      padding: 6px 10px;
      border-radius: 6px;
      margin-top: 8px;
      font-weight: 500;
      cursor: pointer;
    }
    .info button:hover {
      background-color: #e6552f;
    }
  `;
  document.head.appendChild(btnStyle);

});
// 自定义 Geocoder 搜索框样式，使其外观与 HousingPrice.html 一致，包括高亮颜色、放大镜图标、边框样式
const style = document.createElement('style');
style.textContent = `
  .mapboxgl-ctrl-geocoder {
    width: 350px !important;
    margin: 20px !important;
    background-color: white !important;
    border: 2px solid #f4623a !important;
    box-shadow: 0 0 6px rgba(244, 98, 58, 0.4) !important;
    border-radius: 8px !important;
    z-index: 10 !important;
    transition: box-shadow 0.2s, border 0.2s;
  }
  .mapboxgl-ctrl-geocoder input {
    font-size: 16px !important;
    font-weight: 500 !important;
    color: #333 !important;
    background-color: #fff !important;
    border-radius: 6px !important;
    border: none !important;
    box-shadow: none !important;
  }
  .mapboxgl-ctrl-geocoder:hover,
  .mapboxgl-ctrl-geocoder input:focus {
    border: 2px solid #f4623a !important;
    box-shadow: 0 0 14px rgba(244, 98, 58, 0.75) !important;
  }
  .mapboxgl-ctrl-geocoder--suggestion {
    color: #333;
  }
  .mapboxgl-ctrl-geocoder--suggestion.mapboxgl-ctrl-geocoder--suggestion-active {
    background-color: rgba(244, 98, 58, 0.2);
  }
`;
document.head.appendChild(style);
// 邮编搜索功能已由 MapboxGeocoder 控件替代