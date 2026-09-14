import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'render_mesh.dart';

enum RigJoint { none, legL, legR, armL, armR, tail, head, wingL, wingR, cape }

final class _Part {
  const _Part(this.shape, this.size, this.at, this.color, this.joint, this.pivot, this.rotation);
  final String shape;
  final List<double> size, at, pivot, rotation;
  final int color;
  final RigJoint joint;
}

/// A model from `models/creatures/*.json`, expanded into native-animated low-poly geometry.
final class CreatureRig {
  CreatureRig._(this.id, this._parts);

  final String id;
  final List<_Part> _parts;

  factory CreatureRig.fromJson(String id, String source, {List<int> palette = const <int>[]}) {
    final value = jsonDecode(source);
    if (value is! Map<String, dynamic>) throw FormatException('$id: model must be an object');
    final parts = <_Part>[];
    final recipe = value['from'];
    final options = (value['with'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
    if (recipe == 'biped') parts.addAll(_biped(options, palette));
    if (recipe == 'quadruped') parts.addAll(_quadruped(options, palette));
    if (recipe != null && recipe != 'biped' && recipe != 'quadruped') {
      throw FormatException('$id: unsupported model generator "$recipe"');
    }
    final extras = value['parts'];
    if (extras != null) {
      if (extras is! List) throw FormatException('$id.parts: expected a list');
      for (var i = 0; i < extras.length; i++) {
        if (extras[i] is! Map) throw FormatException('$id.parts[$i]: expected an object');
        parts.add(_readPart((extras[i] as Map).cast<String, dynamic>(), palette, '$id.parts[$i]'));
      }
    }
    if (parts.isEmpty) throw FormatException('$id: model draws nothing');
    return CreatureRig._(id, parts);
  }

  /// Builds one instance. Joint and pivot attributes remain in the buffer; walking,
  /// looking, wings and cape motion are evaluated by the native vertex shader.
  RenderMesh instantiate({required String instanceId, double x = 0, double y = 0, double z = 0, double yaw = 0}) {
    final builder = _RigBuilder(x, y, z, yaw);
    for (final part in _parts) {
      switch (part.shape) {
        case 'box': builder.box(part);
        case 'cyl': builder.round(part, cone: false);
        case 'cone': builder.round(part, cone: true);
        case 'ico': builder.ico(part);
      }
    }
    return RenderMesh(
      id: 'rig:$id:$instanceId',
      vertices: Float32List.fromList(builder.vertices),
      indices: Int32List.fromList(builder.indices),
    );
  }

  static List<_Part> _biped(Map<String, dynamic> o, List<int> palette) {
    final skin = _hex(o['skin'] ?? '#ffdab9');
    final hair = _hex(o['hair'] ?? '#ffffff');
    final trousers = _hex(o['pantsColor'] ?? '#4a3a2a');
    final build = (o['build'] as num?)?.toDouble() ?? 1;
    final arm = 1 + (build - 1) * .55, leg = 1 + (build - 1) * .5;
    final hang = .25 * build, stance = .095 * (1 + (build - 1) * .4);
    final headPivot = <double>[0, 1.2, 0];
    _Part box(List<double> s, List<double> at, int color, {RigJoint joint = RigJoint.none, List<double>? pivot, int? tint}) =>
        _Part('box', s, at, _tint(color, tint, palette), joint, pivot ?? at, const <double>[0, 0, 0]);
    return <_Part>[
      box(<double>[.14,.1,.16], <double>[0,1.15,0], skin),
      box(<double>[.3,.32,.3], <double>[0,1.36,0], skin, joint: RigJoint.head, pivot: headPivot),
      box(<double>[.32,.12,.32], <double>[0,1.48,0], hair, joint: RigJoint.head, pivot: headPivot, tint: _integer(o['hairTint'])),
      box(<double>[.08,.075,.32], <double>[.13,1.435,0], hair, joint: RigJoint.head, pivot: headPivot, tint: _integer(o['hairTint'])),
      box(<double>[.09,.26,.31], <double>[-.135,1.37,0], hair, joint: RigJoint.head, pivot: headPivot, tint: _integer(o['hairTint'])),
      box(<double>[.27*build,.54,.36*build], <double>[0,.89,0], 0xffffff, tint: _integer(o['shirtTint'])),
      box(<double>[.29*build,.11,.46*build], <double>[0,1.11,0], 0xffffff, tint: _integer(o['shirtTint'])),
      box(<double>[.1,.42,.1*arm], <double>[0,.93,hang], skin, joint: RigJoint.armL, pivot: <double>[0,1.14,hang], tint: _integer(o['armTint'])),
      box(<double>[.1,.42,.1*arm], <double>[0,.93,-hang], skin, joint: RigJoint.armR, pivot: <double>[0,1.14,-hang], tint: _integer(o['armTint'])),
      box(<double>[.12,.1,.12], <double>[0,.68,hang], skin, joint: RigJoint.armL, pivot: <double>[0,1.14,hang], tint: _integer(o['armTint'])),
      box(<double>[.12,.1,.12], <double>[0,.68,-hang], skin, joint: RigJoint.armR, pivot: <double>[0,1.14,-hang], tint: _integer(o['armTint'])),
      box(<double>[.15,.54,.15*leg], <double>[0,.35,stance], trousers, joint: RigJoint.legL, pivot: <double>[0,.62,stance], tint: _integer(o['pantsTint'])),
      box(<double>[.15,.54,.15*leg], <double>[0,.35,-stance], trousers, joint: RigJoint.legR, pivot: <double>[0,.62,-stance], tint: _integer(o['pantsTint'])),
      box(<double>[.17,.075,.115], <double>[.025,.038,stance], 0x3a2a1a, joint: RigJoint.legL, pivot: <double>[0,.62,stance], tint: _integer(o['bootTint'])),
      box(<double>[.17,.075,.115], <double>[.025,.038,-stance], 0x3a2a1a, joint: RigJoint.legR, pivot: <double>[0,.62,-stance], tint: _integer(o['bootTint'])),
    ];
  }

  static List<_Part> _quadruped(Map<String, dynamic> o, List<int> palette) {
    final body = _numbers(o['body'], 3, 'quadruped.body');
    final head = _numbers(o['head'], 3, 'quadruped.head');
    final headAt = _numbers(o['headOffset'], 3, 'quadruped.headOffset');
    final bodyColor = _hex(o['bodyColor']);
    final legColor = o['legColor'] == null ? bodyColor : _hex(o['legColor']);
    final headColor = o['headColor'] == null ? bodyColor : _hex(o['headColor']);
    final legH = (o['legH'] as num).toDouble(), legW = (o['legW'] as num).toDouble();
    final inset = (o['legInset'] as num?)?.toDouble() ?? .12;
    final lx = body[0] / 2 - inset, lz = body[2] / 2 - legW / 2;
    final parts = <_Part>[
      _Part('box', body, <double>[0,(o['bodyY'] as num).toDouble(),0], _tint(bodyColor,_integer(o['bodyTint']),palette), RigJoint.none, const <double>[0,0,0], const <double>[0,0,0]),
      _Part('box', head, headAt, _tint(headColor,_integer(o['headTint'] ?? o['bodyTint']),palette), RigJoint.head, <double>[headAt[0]-head[0]/2,headAt[1],0], const <double>[0,0,0]),
    ];
    if (o['neck'] != null && o['neckOffset'] != null) {
      parts.add(_Part(
        'box', _numbers(o['neck'], 3, 'quadruped.neck'),
        _numbers(o['neckOffset'], 3, 'quadruped.neckOffset'),
        _tint(bodyColor, _integer(o['bodyTint']), palette), RigJoint.none,
        const <double>[0,0,0], <double>[0,0,(o['neckRot'] as num?)?.toDouble() ?? 0],
      ));
    }
    final points = <(double,double,RigJoint)>[(lx,lz,RigJoint.legL),(lx,-lz,RigJoint.legR),(-lx,lz,RigJoint.legR),(-lx,-lz,RigJoint.legL)];
    for (final (px,pz,joint) in points) {
      parts.add(_Part('box', <double>[legW,legH,legW], <double>[px,legH/2,pz], _tint(legColor,_integer(o['legTint'] ?? o['bodyTint']),palette), joint, <double>[px,legH,pz], const <double>[0,0,0]));
    }
    final tailValue = o['tail'];
    if (tailValue is Map) {
      final tail = tailValue.cast<String, dynamic>();
      final size = _numbers(tail['size'], 3, 'quadruped.tail.size');
      final at = _numbers(tail['offset'], 3, 'quadruped.tail.offset');
      parts.add(_Part(
        'box', size, at, _tint(_hex(tail['color']), _integer(tail['tint']), palette),
        RigJoint.tail, <double>[at[0],at[1]+size[1]/2,at[2]],
        tail['rot'] == null ? const <double>[0,0,0] : (tail['rot'] as List).map(_angle).toList(),
      ));
    }
    return parts;
  }

  static _Part _readPart(Map<String, dynamic> value, List<int> palette, String where) {
    final shapes = <String>['box','cyl','cone','ico'].where(value.containsKey).toList();
    if (shapes.length != 1) throw FormatException('$where: expected exactly one shape');
    final shape = shapes.single;
    final size = switch (shape) {
      'box' => _numbers(value[shape], 3, '$where.$shape'),
      'cyl' => <double>[(value[shape] as List)[0].toDouble(), (value[shape] as List)[1].toDouble(), (value[shape] as List)[0].toDouble()],
      'cone' => <double>[0, (value[shape] as List)[1].toDouble(), (value[shape] as List)[0].toDouble()],
      _ => <double>[(value[shape] as num).toDouble()],
    };
    final at = _numbers(value['at'], 3, '$where.at');
    return _Part(shape, size, at, _tint(_hex(value['color']), _integer(value['tint']), palette),
        _joint(value['anim']), value['pivot'] == null ? at : _numbers(value['pivot'],3,'$where.pivot'),
        value['rot'] == null ? const <double>[0,0,0] : (value['rot'] as List).map(_angle).toList());
  }

  static int _hex(Object? value) {
    if (value is! String || !RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(value)) throw FormatException('expected #rrggbb colour');
    return int.parse(value.substring(1), radix: 16);
  }
  static int? _integer(Object? value) => value is num ? value.toInt() : null;
  static int _tint(int color, int? tint, List<int> palette) => tint != null && tint >= 0 && tint < palette.length ? palette[tint] : color;
  static List<double> _numbers(Object? value, int count, String where) {
    if (value is! List || value.length != count || value.any((v) => v is! num)) throw FormatException('$where: expected $count numbers');
    return value.cast<num>().map((v) => v.toDouble()).toList(growable: false);
  }
  static double _angle(Object? value) {
    if (value is num) return value.toDouble();
    final match = RegExp(r'^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$').firstMatch(value.toString());
    if (match == null) throw FormatException('invalid turn fraction $value');
    return double.parse(match[1]!) / double.parse(match[2]!) * math.pi * 2;
  }
  static RigJoint _joint(Object? value) => RigJoint.values.where((j) => j.name == value).firstOrNull ?? RigJoint.none;
}

final class _RigBuilder {
  _RigBuilder(this.x, this.y, this.z, this.yaw);
  final double x, y, z, yaw;
  final vertices = <double>[];
  final indices = <int>[];

  void box(_Part p) {
    final hx=p.size[0]/2, hy=p.size[1]/2, hz=p.size[2]/2;
    _quad(p,[-hx,-hy,-hz],[-hx,hy,-hz],[hx,hy,-hz],[hx,-hy,-hz],[0,0,-1]);
    _quad(p,[hx,-hy,hz],[hx,hy,hz],[-hx,hy,hz],[-hx,-hy,hz],[0,0,1]);
    _quad(p,[-hx,-hy,hz],[-hx,hy,hz],[-hx,hy,-hz],[-hx,-hy,-hz],[-1,0,0]);
    _quad(p,[hx,-hy,-hz],[hx,hy,-hz],[hx,hy,hz],[hx,-hy,hz],[1,0,0]);
    _quad(p,[-hx,hy,-hz],[-hx,hy,hz],[hx,hy,hz],[hx,hy,-hz],[0,1,0]);
    _quad(p,[-hx,-hy,hz],[-hx,-hy,-hz],[hx,-hy,-hz],[hx,-hy,hz],[0,-1,0]);
  }

  void round(_Part p, {required bool cone}) {
    const sides=8;
    final top=cone?0.0:p.size[0], bottom=p.size[2], half=p.size[1]/2;
    for(var i=0;i<sides;i++) {
      final a=i*math.pi*2/sides,b=(i+1)*math.pi*2/sides;
      final n=<double>[math.cos((a+b)/2),0,math.sin((a+b)/2)];
      _quad(p,[bottom*math.cos(a),-half,bottom*math.sin(a)],[top*math.cos(a),half,top*math.sin(a)],[top*math.cos(b),half,top*math.sin(b)],[bottom*math.cos(b),-half,bottom*math.sin(b)],n);
    }
  }

  void ico(_Part p) {
    final r=p.size[0];
    final points=<List<double>>[[0,r,0],[r,0,0],[0,0,r],[-r,0,0],[0,0,-r],[0,-r,0]];
    for(final f in const <List<int>>[[0,1,2],[0,2,3],[0,3,4],[0,4,1],[5,2,1],[5,3,2],[5,4,3],[5,1,4]]) {
      _triangle(p,points[f[0]],points[f[1]],points[f[2]]);
    }
  }

  void _quad(_Part p,List<double>a,List<double>b,List<double>c,List<double>d,List<double>n) {
    final base=vertices.length~/RenderMesh.floatsPerVertex;
    for(final point in [a,b,c,d]) {_vertex(p,point,n);}
    indices.addAll([base,base+1,base+2,base,base+2,base+3]);
  }
  void _triangle(_Part p,List<double>a,List<double>b,List<double>c) {
    final ab=<double>[b[0]-a[0],b[1]-a[1],b[2]-a[2]], ac=<double>[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    final n=<double>[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    final l=math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]); for(var i=0;i<3;i++) n[i]/=l;
    final base=vertices.length~/RenderMesh.floatsPerVertex; _vertex(p,a,n);_vertex(p,b,n);_vertex(p,c,n);indices.addAll([base,base+1,base+2]);
  }
  void _vertex(_Part p,List<double>point,List<double>normal) {
    final q=_rotate(point,p.rotation), n=_rotate(normal,p.rotation);
    final px=q[0]+p.at[0],py=q[1]+p.at[1],pz=q[2]+p.at[2];
    final cy=math.cos(yaw),sy=math.sin(yaw);
    final color=_linear(p.color);
    vertices.addAll(<double>[x+px*cy-pz*sy,y+py,z+px*sy+pz*cy,n[0]*cy-n[2]*sy,n[1],n[0]*sy+n[2]*cy,...color,0,p.joint.index.toDouble(),x+p.pivot[0]*cy-p.pivot[2]*sy,y+p.pivot[1],z+p.pivot[0]*sy+p.pivot[2]*cy]);
  }
  static List<double> _rotate(List<double> v,List<double> r) {
    var x=v[0],y=v[1],z=v[2];
    var c=math.cos(r[0]),s=math.sin(r[0]); var ny=y*c-z*s,nz=y*s+z*c;y=ny;z=nz;
    c=math.cos(r[1]);s=math.sin(r[1]);var nx=x*c+z*s;nz=-x*s+z*c;x=nx;z=nz;
    c=math.cos(r[2]);s=math.sin(r[2]);nx=x*c-y*s;ny=x*s+y*c;return [nx,ny,z];
  }
  static List<double> _linear(int hex)=>[for(final v in [(hex>>16)&255,(hex>>8)&255,hex&255]) if(v/255<=.04045) v/255/12.92 else math.pow((v/255+.055)/1.055,2.4).toDouble()];
}
