// 1. Mapbox 初始化
mapboxgl.accessToken = 'pk.eyJ1IjoiY2h0MTk5OCIsImEiOiJjbTZzMHR3a2UwMmU4Mmpxdm9vbm8zdDBsIn0.sS9cb0C04bji7VbyKL6Bzw';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v9',
  center: [-0.1278, 51.5074],
  zoom: 10
});

map.addControl(new mapboxgl.NavigationControl());


let londonBoundary = null;

// 2. 加载伦敦 LSOA 边界
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

// 3. 定义 POI 类型映射与颜色
const categoryColors = {
  shop: 'rgba(21, 101, 192, 0.8)',
  food: 'rgba(247, 152, 114, 0.8)'  ,
  health: 'rgba(217, 75, 58, 0.8)'  ,
  leisure:'rgba(147, 185, 217, 0.8)'
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

// 4. 加载 POI 并聚合显示
function loadPOIData() {
  fetch('./data/poi_london.geojson')
    .then(res => res.json())
    .then(data => {
      // 过滤和整理 POI 数据
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

      // 仅保留在伦敦边界内的 POI
      if (londonBoundary) {
        data.features = data.features.filter(f => turf.booleanPointInPolygon(f, londonBoundary));
      }

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

      // 添加聚合数字图层（每个类别）
      categories.forEach(cat => {
        map.addLayer({
          id: `cluster-count-${cat}`,
          type: 'symbol',
          source: `pois-${cat}`,
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
      });

      // 缩放切换聚合/单点（已由下方统一处理，这里移除）

      // POI 单点点击弹窗
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

      // 聚合点击放大
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
// 5. 搜索邮编并绘制等时圈
async function searchByPostcode(postcode, duration = 600) {
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${postcode}`);
    const resJson = await res.json();
    if (!resJson.result) {
      alert('Postcode not found. Please input a valid UK postcode.');
      return;
    }
    const { latitude, longitude } = resJson.result;

    const isoRes = await fetch(`https://api.openrouteservice.org/v2/isochrones/foot-walking?api_key=5b3ce3597851110001cf62483837ef5a171e432fa95123a6dc1bf175`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [[longitude, latitude]], range: [duration] })
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

    if (postcodeMarker) postcodeMarker.remove();
    postcodeMarker = new mapboxgl.Marker().setLngLat([longitude, latitude]).addTo(map);

    const popupContent = `
      <b>Postcode: ${postcode}</b><br>
      🛍️ Shops: ${counts.shop}<br>
      🍔 Food and Drink: ${counts.food}<br>
      🏥 Health: ${counts.health}<br>
      🌿 Leisure: ${counts.leisure}
    `;
    new mapboxgl.Popup().setLngLat([longitude, latitude]).setHTML(popupContent).addTo(map);
    map.easeTo({ center: [longitude, latitude], zoom: 13 });

  } catch (e) {
    alert('Postcode not found or ORS error.');
  }
}

// 6. LSOA 图层加载与点击高亮统计
map.on('load', () => {
  // 静态 DOM 获取
  const infoPanel = document.getElementById('info-panel');
  const checkPanel = document.getElementById('check-panel');
  const legendPanel = document.getElementById('legend-panel');
  const searchPanel = document.getElementById('custom-search-panel');

  // 加载 LSOA 边界及高亮图层
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

  // 点击地图任意处，检测是否在LSOA区域内，高亮并统计POI
  map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ['lsoa-fill']
    });
    if (!features.length) {
      // 新增：如果点击在等时圈层上，不清除等时圈
      const featuresAtIso = map.queryRenderedFeatures(e.point, { layers: ['isochrone-layer'] });
      if (featuresAtIso.length) return;
      // 点击空白处清除高亮和 popup
      if (map.getSource('highlighted-lsoa')) {
        map.getSource('highlighted-lsoa').setData({
          type: 'FeatureCollection',
          features: []
        });
      }
      if (map.getSource('isochrone')) {
        map.getSource('isochrone').setData({
          type: 'FeatureCollection',
          features: []
        });
      }
      if (searchMarker) {
        searchMarker.remove();
        searchMarker = null;
      }
      // 清除所有 mapboxgl.Popup 实例
      const popups = document.getElementsByClassName('mapboxgl-popup');
      while (popups[0]) {
        popups[0].remove();
      }
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
      🍔 Food and Drink: ${counts.food}<br>
      🏥 Health: ${counts.health}<br>
      🌿 Leisure: ${counts.leisure}
    `;

    new mapboxgl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);
  });

  // 7. 图标加载完成后触发 POI 加载
  const iconList = [
    'supermarket', 'convenience', 'mall', 'marketplace',
    'fast_food', 'cafe', 'bar',
    'hospital', 'clinic', 'pharmacy',
    'park', 'sports_centre', 'fitness_centre'
  ];
  let iconsLoaded = 0;

  iconList.forEach(name => {
    map.loadImage(`./icon/${name}.png`, (error, image) => {
      iconsLoaded++;
      if (!error && !map.hasImage(name)) {
        map.addImage(name, image);
      }
      if (iconsLoaded === iconList.length) {
        loadPOIData();
      }
    });
  });

  // 3秒超时后强制加载POI（容错）
  setTimeout(() => {
    if (!poiData) {
      loadPOIData();
    }
  }, 3000);

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
      🍔 Food and Drink: ${counts.food}<br>
      🏥 Health: ${counts.health}<br>
      🌿 Leisure: ${counts.leisure}
    `;
    new mapboxgl.Popup().setLngLat([lon, lat]).setHTML(popupContent).addTo(map);
  });

  infoPanel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', e => {
      const layerId = e.target.getAttribute('data-layer');
      const cat = layerId.split('-')[1]; // shop/food/health/leisure
      const clusterLayer = `clusters-${cat}`;
      const countLayer = `cluster-count-${cat}`;
      const unclusteredLayer = `unclustered-${cat}`;
      const vis = e.target.checked ? 'visible' : 'none';
      if (map.getLayer(clusterLayer)) {
        map.setLayoutProperty(clusterLayer, 'visibility', vis);
      }
      if (map.getLayer(countLayer)) {
        map.setLayoutProperty(countLayer, 'visibility', vis);
      }
      if (map.getLayer(unclusteredLayer)) {
        map.setLayoutProperty(unclusteredLayer, 'visibility', vis === 'visible' && map.getZoom() >= 13 ? 'visible' : 'none');
      }
    });
  });


  // 监听缩放，按复选框状态控制图层显示（修复：不覆盖用户操作）
  map.on('zoom', () => {
    const z = map.getZoom();
    const categories = ['shop', 'food', 'health', 'leisure'];
    categories.forEach(cat => {
      const checkbox = document.getElementById(`chk-${cat}`);
      if (!checkbox) return;
      const isChecked = checkbox.checked;

      if (!isChecked) {
        ['clusters', 'cluster-count', 'unclustered'].forEach(prefix => {
          const layerId = `${prefix}-${cat}`;
          if (map.getLayer(layerId)) {
            map.setLayoutProperty(layerId, 'visibility', 'none');
          }
        });
        return;
      }

      const clusterVis = z < 13 ? 'visible' : 'none';
      const countVis = z < 13 ? 'visible' : 'none';
      const unclusteredVis = z >= 13 ? 'visible' : 'none';

      if (map.getLayer(`clusters-${cat}`)) map.setLayoutProperty(`clusters-${cat}`, 'visibility', clusterVis);
      if (map.getLayer(`cluster-count-${cat}`)) map.setLayoutProperty(`cluster-count-${cat}`, 'visibility', countVis);
      if (map.getLayer(`unclustered-${cat}`)) map.setLayoutProperty(`unclustered-${cat}`, 'visibility', unclusteredVis);
    });
  });

});
// 10. 自定义搜索框样式
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