var map;

var mode = "foot";

const colors = {
  public: "#005908",
  noaccess: "#A2D61D",
  unspecified: "#8e00cc",
  label: "#000",
  poiLabel: "#4A282A",
  labelHalo: "rgba(255, 255, 255, 1)",
  selection: "yellow",
};

const poiLabelZoom = 14;

var selectedEntityInfo;
var hoveredEntityInfo;

var osmEntityCache = {};
var osmEntityMembershipCache = {};
var osmChangesetCache = {};

function cacheEntities(elements, full) {
  for (var i in elements) {
    var element = elements[i];
    var type = element.type;
    var id = element.id;
    var key = type[0] + id;
    
    osmEntityCache.full = full;

    osmEntityCache[key] = element;
  }
}

async function fetchOsmEntity(type, id) {
  var key = type[0] + id;
  if (!osmEntityCache[key] || !osmEntityCache[key].full) {
    var url = `https://api.openstreetmap.org/api/0.6/${type}/${id}`;
    if (type !== 'node') {
      url += '/full';
    }
    url += '.json';
    var response = await fetch(url);
    var json = await response.json();
    cacheEntities(json && json.elements || [], true);
  }
  return osmEntityCache[key];
}

async function fetchOsmEntityMemberships(type, id) {
  var key = type[0] + id;

  if (!osmEntityMembershipCache[key]) {
    var response = await fetch(`https://api.openstreetmap.org/api/0.6/${type}/${id}/relations.json`);
    var json = await response.json();
    var rels = json && json.elements || [];

    osmEntityMembershipCache[key] = [];
    rels.forEach(function(rel) {
      rel.members.forEach(function(membership) {
        if (membership.ref === id && membership.type === type) {
          osmEntityMembershipCache[key].push({
            key: rel.type[0] + rel.id,
            role: membership.role,
          });
        }
      });
    });
    
    // response relations are fully defined entities so we can cache them for free
    cacheEntities(rels, false);
  }

  return osmEntityMembershipCache[key];
}

async function fetchOsmChangeset(id) {
  if (!osmChangesetCache[id]) {
    var url = `https://api.openstreetmap.org/api/0.6/changeset/${id}.json`;
    var response = await fetch(url);
    var json = await response.json();
    osmChangesetCache[id] = json && json.elements && json.elements.length && json.elements[0];
  }
  return osmChangesetCache[id];
}


function selectEntity(entityInfo) {

  if (!selectedEntityInfo && !entityInfo) return;
  if (selectedEntityInfo && entityInfo &&
    selectedEntityInfo.id === entityInfo.id &&
    selectedEntityInfo.type === entityInfo.type
  ) return;

  selectedEntityInfo = entityInfo;

  var type = selectedEntityInfo && selectedEntityInfo.type;
  var entityId = selectedEntityInfo && selectedEntityInfo.id;

  setHashParameters({
    selected: selectedEntityInfo ? type + "/" + entityId : null
  });

  updateMapForSelection();
  clearHoverIfSelected();
  updateForHover();

  updateSidebar(selectedEntityInfo);

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

function updateMapForSelection() {

  var id = selectedEntityInfo && selectedEntityInfo.id;
  var type = selectedEntityInfo && selectedEntityInfo.type;

  var wayIds = [type === "way" ? id : -1];
  var nodeIds = [type === "node" ? id : -1];

  if (type === "relation") {
    var members = osmEntityCache[type[0] + id]?.members || [];
    members.forEach(function(member) {
      if (member.type === "way") {
        wayIds.push(member.ref);
      } else if (member.type === "node") {
        nodeIds.push(member.ref);
      } else if (member.type === "relation") {
        // only recurse down if we have the entity cached
        var childRelationMembers = osmEntityCache[member.type[0] + member.ref]?.members || [];
        childRelationMembers.forEach(function(member) {
          if (member.type === "way") {
            wayIds.push(member.ref);
          } else if (member.type === "node") {
            nodeIds.push(member.ref);
          }
          // don't recurse relations again in case of self-references
        });
      }
    });
  }

  map.setFilter('selected-paths', ["in", "OSM_ID", ...wayIds]);
  map.setFilter('selected-pois', ["in", "OSM_ID", ...nodeIds]);
}

function setHashParameters(params) {
  var searchParams = new URLSearchParams(window.location.hash.slice(1));
  for (var key in params) {
    if (params[key]) {
      searchParams.set(key, params[key]);
    } else if (searchParams.has(key)) {
      searchParams.delete(key);
    }
  }
  var hash = "#" + decodeURIComponent(searchParams.toString());
  if (hash !== window.location.hash) {
    window.location.hash = hash;
  }
}


function clearHoverIfSelected() {
  if (hoveredEntityInfo && selectedEntityInfo &&
    hoveredEntityInfo.id == selectedEntityInfo.id &&
    hoveredEntityInfo.type == selectedEntityInfo.type) {
    hoveredEntityInfo = null;
  }
}

function didHover(e) {
  // Change the cursor style as a UI indicator.
  map.getCanvas().style.cursor = 'pointer';

  hoveredEntityInfo = entityForEvent(e);
  clearHoverIfSelected();
  updateForHover();
  e.stopPropagation();
}

function updateTagsTable(tags) {
  var html = "";
  html += `<tr><th>Key</th><th>Value</th></tr>`;
  var keys = Object.keys(tags).sort();
  for (var i in keys) {
    var key = keys[i];
    html += `<tr><td>${key}</td><td>${tags[key]}</td></tr>`;
  }
  document.getElementById('tag-table').innerHTML = html;
}

function updateMembershipsTable(memberships) {
  var html = "";
 
  if (memberships.length) {
    html += `<tr><th>Relation</th><th>Type</th><th>Role</th></tr>`;
    for (var i in memberships) {
      var membership = memberships[i];
      var rel = osmEntityCache[membership.key];
      var label = rel.tags.name || rel.id;
      var relType = rel.tags.type || '';
      if ((relType === "route" || relType === "superroute") && rel.tags.route) {
        relType += " (" + (rel.tags.route || rel.tags.superroute) + ")";
      }
      html += `<tr><td><a href="#" onclick="didClickEntityLink(event);" key="${membership.key}">${label}</a></td><td>${relType}</td><td>${membership.role}</td></tr>`;
    }
  } else {
    html += `<tr><th>Relations</th></tr>`;
    html += `<tr><td><i>none</i></td></tr>`;
  }
  document.getElementById('relations-table').innerHTML = html;
}

function didClickEntityLink(e) {
  e.preventDefault();
  selectEntity(osmEntityCache[e.target.getAttribute("key")]);
}

function getFormattedDate(date) {
  var offsetDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60 * 1000));
  var components = offsetDate.toISOString().split('T')
  return components[0] + " " + components[1].split(".")[0];
}

function updateMetaTable(entity, changeset) {
  var formattedDate = getFormattedDate(new Date(entity.timestamp));
  var comment = changeset && changeset.tags && changeset.tags.comment || '';
  var html = "";
  html += `<tr><th colspan='2'>Meta</th></tr>`;
  html += `<tr><td>ID</td><td><a href="https://www.openstreetmap.org/${entity.type}/${entity.id}" target="_blank">${entity.type}/${entity.id}</a></td></tr>`;
  html += `<tr><td>Version</td><td><a href="https://www.openstreetmap.org/${entity.type}/${entity.id}/history" target="_blank">${entity.version}</a></td></tr>`;
  html += `<tr><td>Changeset</td><td><a href="https://www.openstreetmap.org/changeset/${entity.changeset}" target="_blank">${entity.changeset}</a></td></tr>`;
  html += `<tr><td>Comment</td><td>${comment}</td></tr>`;
  html += `<tr><td>Uploaded</td><td>${formattedDate}</td></tr>`;
  html += `<tr><td>User</td><td><a href="https://www.openstreetmap.org/user/${entity.user}" target="_blank">${entity.user}</a></td></tr>`;
  document.getElementById('meta-table').innerHTML = html;
}

function entityForEvent(e) {
  var feature = e.features.length && e.features[0];
  if (feature && feature.properties.OSM_ID) {
    var type = feature.sourceLayer.includes("poi") ? 'node' : 'way';
    return {
      id: feature.properties.OSM_ID,
      type: type,
      focusLngLat: e.lngLat,
    };
  }
  return null;
}

function didClick(e) {
  selectEntity(entityForEvent(e));
  e.stopPropagation();
}

function updateSidebar(entity) {

  if (!entity) {
    document.getElementById('sidebar').innerHTML = "";
    return;
  }

  var type = entity.type;
  var entityId = entity.id;
  var focusLngLat = entity.focusLngLat;

  var bbox = focusLngLat && {
    left: left = focusLngLat.lng - 0.001,
    right: right = focusLngLat.lng + 0.001,
    bottom: left = focusLngLat.lat - 0.001,
    top: right = focusLngLat.lat + 0.001,
  };
  
  var opQuery = encodeURIComponent(`${type}(${entityId});\n(._;>;);\nout;`);
  
  var html = '';
  html += "<div class='body'>";
  html += "<table id='tag-table'>";
  html += `<tr><th>Key</th><th>Value</th></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr>`;
  html += "</table><br/>";
  html += "<table id='relations-table'>";
  html += `<tr><th>Relation</th><th>Type</th><th>Route</th><th>Role</th></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr>`;
  html += "</table><br/>";
  html += "<table id='meta-table'>";
  html += `<tr><th colspan='2'>Meta</th></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr>`;
  html += "</table><br/>";
  html += "<h3>View</h3>";
  html += "<p class='link-list'>";
  html += `<a href="https://openstreetmap.org/${type}/${entityId}" target="_blank">osm.org</a> `;
  html += `<a href="https://www.openstreetmap.org/api/0.6/${type}/${entityId}" target="_blank">XML</a> `;
  html += `<a href="https://pewu.github.io/osm-history/#/${type}/${entityId}" target="_blank">PeWu</a> `;
  html += `<a href="https://overpass-turbo.eu?Q=${opQuery}&R=" target="_blank">Overpass Turbo</a> `;
  html += "</p>";
  html += "<h3>Edit</h3>";
  html += "<p class='link-list'>";
  html += `<a href="https://openstreetmap.org/edit?${type}=${entityId}" target="_blank">iD</a> `;
  if (bbox) html += `<a href="http://127.0.0.1:8111/load_and_zoom?left=${bbox.left}&right=${bbox.right}&top=${bbox.top}&bottom=${bbox.bottom}&select=${type}${entityId}" target="_blank">JOSM</a> `;
  html += `<a href="https://level0.osmz.ru/?url=${type}/${entityId}" target="_blank">Level0</a> `;
  html += "</p>";
  html += "</div>";

  document.getElementById('sidebar').innerHTML = html;
}

function updateForHover() {
  var type = hoveredEntityInfo && hoveredEntityInfo.type;
  var entityId = hoveredEntityInfo && hoveredEntityInfo.id;

  // disable hover indicator for now
  // map.setFilter('hovered-paths', ["==", "OSM_ID", type === "way" ? entityId : -1]);
  // map.setFilter('hovered-pois', ["==", "OSM_ID", type === "node" ? entityId : -1]);
}

function didUnhover() {
  map.getCanvas().style.cursor = '';
  hoveredEntityInfo = null;
  updateForHover();
}


var impliedYesExpressions = {
  atv: [
    ["==", "highway", "track"]
  ],
  bicycle: [
    ["==", "highway", "path"],
    ["==", "highway", "cycleway"],
    ["==", "highway", "bridleway"],
    ["==", "highway", "track"]
  ],
  foot: [
    ["==", "highway", "path"],
    ["==", "highway", "footway"],
    ["==", "highway", "steps"],
    ["==", "highway", "bridleway"],
    ["==", "highway", "track"]
  ],
  horse: [
    ["==", "highway", "bridleway"],
    ["==", "highway", "track"]
  ],
  wheelchair: [
    ["==", "smoothness", "excellent"],
    ["==", "smoothness", "very_good"],
    ["==", "smoothness", "good"],
    ["==", "smoothness", "intermediate"],
  ],
};
var impliedNoExpressions = {
  atv: [
    [
      "any",
      ["==", "highway", "footway"],
      ["==", "highway", "steps"],
      ["==", "vehicle", "no"],
      ["==", "vehicle", "private"],
      ["==", "vehicle", "discouraged"],
      ["==", "motor_vehicle", "no"],
      ["==", "motor_vehicle", "private"],
      ["==", "motor_vehicle", "discouraged"],
    ]
  ],
  bicycle: [
    [
      "any",
      [
        "all",
        ["==", "highway", "steps"],
        ["!=", "ramp:bicycle", "yes"],
      ],
      ["==", "vehicle", "no"],
      ["==", "vehicle", "private"],
      ["==", "vehicle", "discouraged"],
    ]
  ],
  foot: [],
  horse: [
    ["==", "highway", "steps"],
  ],
  wheelchair: [
    [
      "any",
      ["==", "highway", "steps"],
      [
        "all",
        ["has", "sac_scale"],
        ["!=", "sac_scale", "hiking"],
      ],
      [
        "all",
        ["has", "smoothness"],
        ["!=", "smoothness", "excellent"],
        ["!=", "smoothness", "very_good"],
        ["!=", "smoothness", "good"],
        ["!=", "smoothness", "intermediate"],
      ]
    ]
  ],
};

function updateLayers() {

  var unspecifiedExpression = [
    "any",
    [
      "all",
      ["!has", mode],
      ["!=", "access", "no"],
      ["!=", "access", "private"],
      ["!=", "access", "discouraged"],
      [
        "none",
        ...impliedYesExpressions[mode],
        ...impliedNoExpressions[mode]
      ]
    ],
    // access if always unspecified if mode is explicitly set to `unknown`
    ["==", mode, "unknown"],
  ];

  var allowedExpression = [
    "all",
    [
      "any",
      [
        "all",
        ["!has", mode],
        ["!=", "access", "no"],
        ["!=", "access", "private"],
        ["!=", "access", "discouraged"],
      ],
      [
        "all",
        ["has", mode],
        ["!=", mode, "no"],
        ["!=", mode, "private"],
        ["!=", mode, "discouraged"],
        ["!=", mode, "limited"], // for `wheelchair`
      ],
    ],
  ];
  if (impliedNoExpressions[mode]) {
    allowedExpression.push(
      [
        "any",
        ["has", mode],
        ["none",
          ...impliedNoExpressions[mode],
        ],
      ]
    );
  }
  
  map.setFilter('paths', [
      "all",
      allowedExpression,
      ["none", unspecifiedExpression],
      ["!=", "informal", "yes"]
    ])
    .setFilter('disallowed-paths', [
      "all",
      ["none", allowedExpression],
      ["none", unspecifiedExpression],
      ["!=", "informal", "yes"]
    ])
    .setFilter('disallowed-informal-paths', [
      "all",
      ["none", allowedExpression],
      ["none", unspecifiedExpression],
      ["==", "informal", "yes"]
    ])
    .setFilter('informal-paths', [
      "all",
      allowedExpression,
      ["none", unspecifiedExpression],
      ["==", "informal", "yes"]
    ]).setFilter('unspecified-informal-paths', [
      "all",
      unspecifiedExpression,
      ["==", "informal", "yes"]
    ])
    .setFilter('unspecified-paths', [
      "all",
      unspecifiedExpression,
      ["!=", "informal", "yes"]
    ]);
}

/*window.addEventListener("hashchange", function () {
  updateForHash();
});*/

function updateForHash() {
  var searchParams = new URLSearchParams(window.location.hash.slice(1));
  if (searchParams.has("selected")) {
    var value = searchParams.get("selected");
    var components = value.split("/");
    if (components.length == 2) {
      var type = components[0];
      var id = parseInt(components[1]);
      if (["node", "way", "relation"].includes(type)) {
        selectEntity({
          type: type,
          id: id,
        });
      }
    }
  }
}

function loadInitialMap() {
  map.addSource("trails", {
    type: "vector",
    url: "https://d1zqyi8v6vm8p9.cloudfront.net/trails.json",
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>'
  });

  var lineWidth = [
      "interpolate", ["linear"], ["zoom"],
      12, 1,
      22, 5
    ];
  var selectedLineWidth = [
      "interpolate", ["linear"], ["zoom"],
      12, 9,
      22, 13
    ];
  var hoverLineWidth = [
      "interpolate", ["linear"], ["zoom"],
      12, 5,
      22, 7
    ];
  var lineOpacity = [
      "interpolate", ["linear"], ["zoom"],
      12, 1,
      22, 0.4
    ];
  var poiIconImage = [
      "match", ["get", "highway"],
      "trailhead", ["image", "trailhead-icon"],
      ["image", "ranger_station-icon"]
    ];
  var poiIconSize = [
      "interpolate", ["linear"], ["zoom"],
      12, 0.5,
      22, 1
    ];

  map.addLayer({
    "id": "hovered-paths",
    "source": "trails",
    "source-layer": "trail",
    "type": "line",
    "layout": {
      "line-cap": "round",
      "line-join": "round"
    },
    "paint": {
      "line-opacity": 0.25,
      "line-color": colors.selection,
      "line-width": hoverLineWidth,
    },
    "filter": [
      "==", "OSM_ID", -1 
    ]
  }).addLayer({
    "id": "hovered-pois",
    "source": "trails",
    "source-layer": "trail_poi",
    "type": "circle",
    "paint": {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        12, 9,
        22, 18
      ],
      "circle-opacity": 0.25,
      "circle-color": colors.selection,
    },
    "filter": [
      "==", "OSM_ID", -1 
    ]
  }).addLayer({
    "id": "selected-paths",
    "source": "trails",
    "source-layer": "trail",
    "type": "line",
    "layout": {
      "line-cap": "round",
      "line-join": "round"
    },
    "paint": {
      "line-opacity": 0.4,
      "line-color": colors.selection,
      "line-width": selectedLineWidth,
    },
    "filter": [
      "==", "OSM_ID", -1 
    ]
  }).addLayer({
    "id": "selected-pois",
    "source": "trails",
    "source-layer": "trail_poi",
    "type": "circle",
    "paint": {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        12, 10,
        22, 20
      ],
      "circle-opacity": 0.4,
      "circle-color": colors.selection,
    },
    "filter": [
      "==", "OSM_ID", -1 
    ]
  }).addLayer({
    "id": "informal-paths",
    "source": "trails",
    "source-layer": "trail",
    "type": "line",
    "layout": {
      "line-cap": "butt",
      "line-join": "round"
    },
    "paint": {
      "line-opacity": lineOpacity,
      "line-width": lineWidth,
      "line-color": colors.public,
      "line-dasharray": [2, 2],
    }
  })
  .addLayer({
    "id": "disallowed-informal-paths",
    "source": "trails",
    "source-layer": "trail",
    "type": "line",
    "layout": {
      "line-cap": "butt",
      "line-join": "round"
    },
    "paint": {
      "line-opacity": lineOpacity,
      "line-width": lineWidth,
      "line-color": colors.noaccess,
      "line-dasharray": [2, 2],
    }
  })
  .addLayer({
    "id": "unspecified-informal-paths",
    "source": "trails",
    "source-layer": "trail",
    "type": "line",
    "layout": {
      "line-cap": "butt",
      "line-join": "round",
    },
    "paint": {
      "line-opacity": lineOpacity,
      "line-width": lineWidth,
      "line-color": colors.unspecified,
      "line-dasharray": [2, 2],
    }
  })
  .addLayer({
    "id": "disallowed-paths",
    "source": "trails",
    "source-layer": "trail",
    "type": "line",
    "layout": {
      "line-cap": "butt",
      "line-join": "round",
    },
    "paint": {
      "line-opacity": lineOpacity,
      "line-width": lineWidth,
      "line-pattern": ["image", "disallowed-stripes"],
    }
  })
  .addLayer({
    "id": "unspecified-paths",
    "source": "trails",
    "source-layer": "trail",
    "type": "line",
    "layout": {
      "line-cap": "butt",
      "line-join": "round",
    },
    "paint": {
      "line-opacity": lineOpacity,
      "line-width": lineWidth,
      "line-color": colors.unspecified,
    }
  })
  .addLayer({
    "id": "paths",
    "source": "trails",
    "source-layer": "trail",
    "type": "line",
    "layout": {
      "line-cap": "butt",
      "line-join": "round",
    },
    "paint": {
      "line-opacity": lineOpacity,
      "line-width": lineWidth,
      "line-color": colors.public,
    }
  })
  .addLayer({
    "id": "trails-labels",
    "source": "trails",
    "source-layer": "trail_name",
    "type": "symbol",
    "layout": {
      "text-field": ['get', 'name'],
      "text-size": 13,
      "symbol-placement": "line"
    },
    "paint": {
      "text-color": colors.label,
      "text-halo-width": 1.5,
      "text-halo-color": colors.labelHalo,
    }
  })
  .addLayer({
    "id": "trails-pointer-targets",
    "source": "trails",
    "source-layer": "trail",
    "type": "line",
    "paint": {
        "line-color": "transparent",
        "line-width": 16
    }
  })
  .addLayer({
    "id": "trail-pois",
    "source": "trails",
    "source-layer": "trail_poi",
    "type": "symbol",
    "transition": {
      "duration": 0,
      "delay": 0
    },
    "layout": {
      "icon-image": poiIconImage,
      "icon-size": poiIconSize,
      "symbol-placement": "point",
      "text-field": ["step", ["zoom"], "", poiLabelZoom, ["get", "name"]],
      "text-optional": true,
      "text-size": 11,
      "text-line-height": 1.1,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Semibold"],
      "text-variable-anchor": ["left", "right", "top", "bottom"],
      "text-padding": 5,
      "text-offset": [
        "interpolate", ["linear"], ["zoom"],
        12, ["literal", [0.4, 0.4]],
        22, ["literal", [1.5, 1.5]]
      ],
      "text-justify": "auto",
    },
    "paint": {
      "text-color": colors.poiLabel,
      "text-halo-width": 2,
      "text-halo-blur": 1,
      "text-halo-color": colors.labelHalo,
    },
  });

  updateLayers();
  updateForHash();
}

window.onload = (event) => {

  document.getElementById("travel-mode").onchange = function(e) {
    mode = e.target.value;
    updateLayers();
  }

  try {
    maptilerApiKey;
  } catch(e) {
      if(e.name == "ReferenceError") {
        // Use the production key if we didn't find a dev key (only works on OSM US domains)
        maptilerApiKey = "qe6b8locBISzDLGJweZ3";
      }
  }

  map = new maplibregl.Map({
    container: 'map',
    hash: "map",
    style: 'https://api.maptiler.com/maps/dataviz/style.json?key=' + maptilerApiKey,
    center: [-97.9, 38.6],
    zoom: 3
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

  map.loadImage('img/disallowed-stripes.png', (error, image) => {
    if (error) throw error;
    map.addImage('disallowed-stripes', image);
  });
  map.loadImage('img/map/trailhead.png', (error, image) => {
    if (error) throw error;
    map.addImage('trailhead-icon', image, { pixelRatio: 2 });
  });
  map.loadImage('img/map/ranger_station.png', (error, image) => {
    if (error) throw error;
    map.addImage('ranger_station-icon', image, { pixelRatio: 2 });
  });

  map.on('load', loadInitialMap);

  map
    .on('mouseenter', 'trail-pois', didHover)
    .on('mouseenter', 'trails-pointer-targets', didHover);

  map
    .on('click', function() {
      selectEntity(null);
    })
    .on('click', 'trail-pois', didClick)
    .on('click', 'trails-pointer-targets', didClick);

  map
    .on('mouseleave', 'trail-pois', didUnhover)
    .on('mouseleave', 'trails-pointer-targets', didUnhover);
}