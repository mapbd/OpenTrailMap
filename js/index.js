var map;

const basicMapStyles = [
  "foot",
  "wheelchair",
  "bicycle",
  "horse",
  "atv",
  "canoe",
  "snowmobile",
];
const defaultMapStyle = "foot";
const defaultAdvancedStyle = "access";
var mapStyle = defaultMapStyle;
var lastAdvancedStyle = defaultAdvancedStyle;

const colors = {
  public: "#005908",
  noaccess: "#A2D61D",
  specified: "#007f79",
  unspecified: "#8e00cc",
  bgwater: "#a6b2c4",
  water: "#003b93",
  label: "#000",
  poiLabel: "#4A282A",
  labelHalo: "rgba(255, 255, 255, 1)",
  selection: "yellow",
};

const poiLabelZoom = 14;

var selectedEntityInfo;
var hoveredEntityInfo;

function selectEntity(entityInfo) {

  if (selectedEntityInfo?.id === entityInfo?.id &&
    selectedEntityInfo?.type === entityInfo?.type
  ) return;

  selectedEntityInfo = entityInfo;

  var type = selectedEntityInfo && selectedEntityInfo.type;
  var entityId = selectedEntityInfo && selectedEntityInfo.id;

  setHashParameters({
    selected: selectedEntityInfo ? type + "/" + entityId : null
  });

  updateMapForSelection();
  updateMapForHover();

  updateSidebar(selectedEntityInfo);

  if (!selectedEntityInfo) return;

  fetchOsmEntity(type, entityId).then(function(entity) {
    if (entity) {
      fetchOsmChangeset(entity.changeset).then(function(changeset) {
        updateMetaTable(entity, changeset);
      });
    }
    var tags = entity && entity.tags;
    if (tags) updateTagsTable(tags);

    // update map again in case we selected a relation and want to highlight members
    updateMapForSelection();
  });

  fetchOsmEntityMemberships(type, entityId).then(function(memberships) {
    updateMembershipsTable(memberships);
  });
}

function setMapStyle(newMapStyle) {
  if (newMapStyle === null) newMapStyle = defaultMapStyle;
  if (newMapStyle === 'all') newMapStyle = lastAdvancedStyle;
  if (mapStyle === newMapStyle) return;
  mapStyle = newMapStyle;

  if (!basicMapStyles.includes(mapStyle)) {
    lastAdvancedStyle = mapStyle
  }

  document.getElementById("map-style").value = basicMapStyles.includes(mapStyle) ? mapStyle : 'all';
  document.getElementById("advanced-style").value = mapStyle;
  document.getElementById("advanced-style").style.display = basicMapStyles.includes(mapStyle) ? 'none' : 'block';

  updateMapLayers();
  setHashParameters({ style: mapStyle === defaultMapStyle ? null : mapStyle });
}

window.onload = (event) => {

  window.addEventListener("hashchange", updateForHash);

  function mapStyleChangeEvent(e) {
    setMapStyle(e.target.value);
  }

  document.getElementById("map-style").addEventListener('change', mapStyleChangeEvent);
  document.getElementById("advanced-style").addEventListener('change', mapStyleChangeEvent); 

  map = new maplibregl.Map({
    container: 'map',
    hash: "map",
    style: './styles/basemap.json',
    center:[23.483,90.110],
    // center: [-111.545,39.546],
    zoom: 6
  });

  // Add zoom and rotation controls to the map.
  map
    .addControl(new maplibregl.NavigationControl({
      visualizePitch: true
    }))
    .addControl(new maplibregl.GeolocateControl({
        positionOptions: {
            enableHighAccuracy: true
        },
        trackUserLocation: true
    }))
    .addControl(new maplibregl.ScaleControl({
        maxWidth: 150,
        unit: 'imperial'
    }), "bottom-left");

  const imageToLoad = [
    'disallowed-stripes',
    'trailhead',
    'ranger-station',
    'canoe',
    'slipway-canoe-trailer',
    'slipway-canoe',
    'oneway-arrow-right',
    'oneway-arrow-left',
  ];

  for (let i in imageToLoad) {
    let img = imageToLoad[i];
    map.loadImage('img/map/' + img + '.png').then(resp => {
      map.addImage(img, resp.data, { pixelRatio: 2 });
    });
  }

  map
    .on('load', loadInitialMap);
}
