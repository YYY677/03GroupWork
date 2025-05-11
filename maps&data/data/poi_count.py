import geopandas as gpd
import pandas as pd
from shapely.geometry import Point
import time


# JS 中的 poiTypes 对应映射
POI_CATEGORY_MAP = {
    'supermarket': 'shop',
    'convenience': 'shop',
    'mall': 'shop',
    'marketplace': 'shop',
    'fast_food': 'food',
    'cafe': 'food',
    'bar': 'food',
    'hospital': 'health',
    'clinic': 'health',
    'pharmacy': 'health',
    'park': 'leisure',
    'sports_centre': 'leisure',
    'fitness_centre': 'leisure',
    'station': 'station'
}

# 将经纬度点转换为缓冲区（步行20分钟 ≈ 1.4km）
def fetch_isochrone(lon, lat, minutes=20):
    # 创建点，投影成米单位，缓冲，投回 WGS84
    pt = gpd.GeoSeries([Point(lon, lat)], crs="EPSG:4326").to_crs(epsg=3857)
    buffer = pt.buffer(1400)  # 半径 1400 米 ≈ 20 分钟
    return buffer.to_crs(epsg=4326).iloc[0]

def classify_poi(row):
    tags = row.get('properties', {})
    raw_type = tags.get('shop') or tags.get('amenity') or tags.get('leisure') or ''
    return POI_CATEGORY_MAP.get(raw_type)

def main():
    # === Step 1: 根据已有的 LSOA 多边形边界文件生成中心点 ===
    full_lsoa = gpd.read_file('maps&data/data/LSOA_21.geojson').to_crs(epsg=4326)
    lsoa_gdf = full_lsoa[['lsoa21cd', 'lsoa21nm', 'geometry']].copy()
    lsoa_gdf['geometry'] = lsoa_gdf.geometry.centroid

    # === Step 2: 读取 POI 数据 ===
    poi_gdf = gpd.read_file('maps&data/data/poi_london.geojson').to_crs(epsg=4326)

    # === Step 3: 分类 POI，依据 JS 逻辑映射 ===
    classified_pois = []
    for idx, row in poi_gdf.iterrows():
        props = row.get('properties', row)
        raw_type = props.get('shop') or props.get('amenity') or props.get('leisure') or props.get('railway')
        if raw_type in ['station', 'subway_entrance']:
            category = 'station'
        else:
            category = POI_CATEGORY_MAP.get(raw_type)
        if not category:
            continue
        classified_pois.append({
            'geometry': row.geometry,
            'category': category,
            'name': props.get('name', None) if category == 'station' else None
        })

    pois_gdf = gpd.GeoDataFrame(classified_pois, crs='EPSG:4326')

    print(f"✅ Loaded {len(pois_gdf)} classified POIs")

    results = []

    # === Step 4: 遍历每个 LSOA 中心点 ===
    for idx, row in lsoa_gdf.iterrows():
        lsoa_code = row['lsoa21cd']
        lsoa_name = row['lsoa21nm']
        lon, lat = row.geometry.x, row.geometry.y
        print(f'🔍 Processing {lsoa_code} ({idx+1}/{len(lsoa_gdf)})')

        isochrone = fetch_isochrone(lon, lat)
        if isochrone is None:
            continue

        # 统计等时圈内的每类 POI 数量
        count = {
            'LSOA21CD': lsoa_code,
            'LSOA21NM': lsoa_name,
            'shop': 0,
            'food': 0,
            'health': 0,
            'leisure': 0,
            'station': 0
        }

        for cat in ['shop', 'food', 'health', 'leisure', 'station']:
            subset = pois_gdf[pois_gdf['category'] == cat]
            if cat == 'station':
                within = subset[subset.within(isochrone)]
                count[cat] = within['name'].dropna().unique().size
            else:
                count[cat] = subset.within(isochrone).sum()

        results.append(count)

    # === Step 5: 导出结果 ===
    df = pd.DataFrame(results, columns=['LSOA21CD', 'LSOA21NM', 'shop', 'food', 'health', 'leisure', 'station'])

    # 合并结果与原始 LSOA 边界
    merged = full_lsoa[['lsoa21cd', 'geometry']].merge(df, left_on='lsoa21cd', right_on='LSOA21CD')
    gdf_result = gpd.GeoDataFrame(merged, geometry='geometry', crs='EPSG:4326')
    gdf_result.to_file('maps&data/data/lsoa_isochrone_20min_counts.geojson', driver='GeoJSON')
    print("✅ Output saved to data/lsoa_isochrone_20min_counts.geojson")

if __name__ == '__main__':
    main()