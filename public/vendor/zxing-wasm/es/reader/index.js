import { A as e, C as t, D as n, E as r, F as i, I as a, L as o, M as s, N as c, O as l, P as u, S as d, T as f, _ as p, a as m, b as h, d as g, f as _, g as ee, h as te, i as ne, j as re, k as ie, l as ae, m as oe, n as v, o as se, p as ce, r as le, s as ue, u as de, v as fe, w as pe, x as me, y } from "../share.js";
//#region src/reader/zxing_reader.js
function he(e, t, n) {
	return t in e ? Object.defineProperty(e, t, {
		value: n,
		enumerable: !0,
		configurable: !0,
		writable: !0
	}) : e[t] = n, e;
}
async function b() {
	let e = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
	var t, n, r, i = e, a = !!globalThis.window, o = !!globalThis.WorkerGlobalScope;
	(n = globalThis.process) != null && (t = n.versions) != null && t.node && ((r = globalThis.process) == null || r.type);
	var s = (e, t) => {
		throw t;
	}, c = void 0, l = "";
	function u(e) {
		return i.locateFile ? i.locateFile(e, l) : l + e;
	}
	var d, f;
	if (a || o || typeof fetch == "function") {
		try {
			l = new URL(".", c).href;
		} catch {}
		o && (f = (e) => {
			var t = new XMLHttpRequest();
			return t.open("GET", e, !1), t.responseType = "arraybuffer", t.send(null), new Uint8Array(t.response);
		}), d = async (e) => {
			var t = await fetch(e, { credentials: "same-origin" });
			if (t.ok) return t.arrayBuffer();
			throw Error(t.status + " : " + t.url);
		};
	}
	console.log.bind(console);
	var p = console.error.bind(console), m, h = !1, g;
	class _ {}
	class ee extends _ {
		constructor(e) {
			super(), this.excPtr = e;
		}
	}
	function te() {
		return nr.buffer;
	}
	function ne() {
		var e;
		if (!(y != null && (e = y.buffer) != null && e.resizable)) {
			var t = te();
			y = new Int8Array(t), Ht = new Int16Array(t), i.HEAPU8 = I = new Uint8Array(t), Y = new Uint16Array(t), Ut = new Int32Array(t), E = new Uint32Array(t), Lt = new Float32Array(t), Rt = new Float64Array(t);
		}
	}
	function re() {
		var e = i.preRun;
		e && (typeof e == "function" && (e = [e]), ge.push(...e)), b(ge);
	}
	function ie() {
		Rr.ra();
	}
	function ae() {
		var e = i.postRun;
		e && (typeof e == "function" && (e = [e]), x.push(...e)), b(x);
	}
	function oe(e) {
		var t;
		throw (t = i.onAbort) == null || t.call(i, e), e = `Aborted(${e})`, p(e), h = !0, e += ". Build with -sASSERTIONS for more info.", new WebAssembly.RuntimeError(e);
	}
	var v;
	function se() {
		return u("zxing_reader.wasm");
	}
	function ce(e) {
		if (e == v && m) return new Uint8Array(m);
		if (f) return f(e);
		throw "both async and sync fetching of the wasm failed";
	}
	async function le(e) {
		if (!m) try {
			var t = await d(e);
			return new Uint8Array(t);
		} catch {}
		return ce(e);
	}
	async function ue(e, t) {
		try {
			var n = await le(e);
			return await WebAssembly.instantiate(n, t);
		} catch (e) {
			p(`failed to asynchronously prepare wasm: ${e}`), oe(e);
		}
	}
	async function de(e, t, n) {
		if (!e) try {
			var r = fetch(t, { credentials: "same-origin" });
			return await WebAssembly.instantiateStreaming(r, n);
		} catch (e) {
			p(`wasm streaming compile failed: ${e}`), p("falling back to ArrayBuffer instantiation");
		}
		return ue(t, n);
	}
	function fe() {
		return { a: ar };
	}
	async function pe() {
		function e(e) {
			return Rr = e.exports, ir(Rr), ne(), Rr;
		}
		function t(t) {
			return e(t.instance);
		}
		var n = fe(), r = i.instantiateWasm;
		return r ? new Promise((t) => {
			r(n, (n) => t(e(n)));
		}) : (v != null || (v = se()), t(await de(m, v, n)));
	}
	class me {
		constructor(e) {
			he(this, "name", "ExitStatus"), this.message = `Program terminated with exit(${e})`, this.status = e;
		}
	}
	var y, b = (e) => {
		for (; e.length > 0;) e.shift()(i);
	}, x = [], ge = [], _e = !0, S = (e) => Yn(e), C = () => Zn(), ve = [], w = (e) => {
		var t = ve[e];
		return t || (ve[e] = t = rr.get(e)), t;
	}, ye = (e, t) => w(e)(t), T = [], be = 0, E;
	class xe {
		set_type(e) {
			E[this.ptr + 4 >> 2] = e;
		}
		get_type() {
			return E[this.ptr + 4 >> 2];
		}
		set_destructor(e) {
			E[this.ptr + 8 >> 2] = e;
		}
		get_destructor() {
			return E[this.ptr + 8 >> 2];
		}
		set_caught(e) {
			e = +!!e, y[this.ptr + 12] = e;
		}
		get_caught() {
			return y[this.ptr + 12] != 0;
		}
		set_rethrown(e) {
			e = +!!e, y[this.ptr + 13] = e;
		}
		get_rethrown() {
			return y[this.ptr + 13] != 0;
		}
		init(e, t) {
			this.set_adjusted_ptr(0), this.set_type(e), this.set_destructor(t);
		}
		set_adjusted_ptr(e) {
			E[this.ptr + 16 >> 2] = e;
		}
		get_adjusted_ptr() {
			return E[this.ptr + 16 >> 2];
		}
		constructor(e) {
			this.excPtr = e, this.ptr = e - 24;
		}
	}
	var Se = (e) => {
		var t = new xe(e);
		return t.get_caught() || (t.set_caught(!0), be--), t.set_rethrown(!1), T.push(t), Kn(e);
	}, D = null, Ce = () => {
		$(0, 0);
		var e = T.pop();
		$n(e.excPtr), D = null;
	}, O = (e) => Jn(e), we = (e) => {
		var t = D == null ? void 0 : D.excPtr;
		if (!t) return O(0), 0;
		var n = new xe(t);
		n.set_adjusted_ptr(t);
		var r = n.get_type();
		if (!r) return O(0), t;
		for (var i of e) {
			if (!i || i === r) break;
			var a = n.ptr + 16;
			if (er(i, r, a)) return O(i), t;
		}
		return O(r), t;
	}, Te = () => we([]), Ee = (e) => we([e]), De = (e, t) => we([e, t]), Oe = (e) => {
		throw e;
	}, ke = () => {
		T.length || oe("no exception to throw");
		var e = T[T.length - 1], t = e.excPtr;
		e.set_rethrown(!0), e.set_caught(!1), be++, Qn(t), t = D = new ee(t), Oe(t);
	}, Ae = (e, t, n) => {
		new xe(e).init(t, n), Qn(e), e = D = new ee(e), be++, Oe(e);
	}, je = (e) => {
		throw e;
	}, Me = (e) => {
		e = D == null ? D = new ee(e) : D, je(e);
	}, Ne = () => oe(""), k = {}, Pe = (e) => {
		for (; e.length;) {
			var t = e.pop();
			e.pop()(t);
		}
	};
	function A(e) {
		return this.fromWireType(E[e >> 2]);
	}
	var j = {}, M = {}, N = {};
	class Fe extends Error {
		constructor(e) {
			super(e), this.name = "InternalError";
		}
	}
	var P = (e) => {
		throw new Fe(e);
	}, F = (e, t, n) => {
		e.forEach((e) => N[e] = t);
		function r(t) {
			var r = n(t);
			r.length !== e.length && P("Mismatched type converter count");
			for (var i = 0; i < e.length; ++i) B(e[i], r[i]);
		}
		var i = Array(t.length), a = [], o = 0;
		for (let [e, n] of t.entries()) M.hasOwnProperty(n) ? i[e] = M[n] : (a.push(n), j.hasOwnProperty(n) || (j[n] = []), j[n].push(() => {
			i[e] = M[n], ++o, o === a.length && r(i);
		}));
		a.length === 0 && r(i);
	}, Ie = (e) => Xn(e), I, Le = (e, t) => I.fill(0, e, e + t), Re = (e) => {
		var t = k[e];
		delete k[e];
		var n = t.rawConstructor, r = t.rawDestructor, i = t.valueSize, a = t.isTrivial, o = t.fields, s = o.map((e) => e.getterReturnType).concat(o.map((e) => e.setterArgumentType));
		F([e], s, (e) => {
			var s = {};
			for (var [c, l] of o.entries()) {
				let t = e[c], n = l.getter, r = l.getterContext, i = e[c + o.length], a = l.setter, d = l.setterContext;
				var u = i.destructorFunction === null && !i.argStackAlloc ? (e, t) => a(d, e, i.toWireType(null, t)) : (e, t) => {
					var n = [];
					a(d, e, i.toWireType(n, t)), Pe(n);
				};
				s[l.fieldName] = {
					read: (e) => t.fromWireType(n(r, e)),
					write: u,
					optional: t.optional
				};
			}
			return [{
				name: t.name,
				fromWireType: (e) => {
					var t = {};
					for (var n in s) t[n] = s[n].read(e);
					return r(e), t;
				},
				toWireType: (e, t) => {
					for (var o in s) if (!(o in t) && !s[o].optional) throw TypeError(`Missing field: "${o}"`);
					var c;
					for (o in a && !e ? (c = Ie(i), Le(c, i)) : (c = n(), e && e.push(r, c)), s) s[o].write(c, t[o]);
					return c;
				},
				readValueFromPointer: A,
				destructorFunction: a ? null : r,
				argStackAlloc: a
			}];
		});
	}, ze = (e, t, n, r, i) => {}, L = (e) => {
		for (var t = "";;) {
			var n = I[e++];
			if (!n) return t;
			t += String.fromCharCode(n);
		}
	};
	class R extends Error {
		constructor(e) {
			super(e), this.name = "BindingError";
		}
	}
	var z = (e) => {
		throw new R(e);
	};
	function Be(e, t) {
		let n = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
		var r = t.name;
		if (e || z(`type "${r}" must have a positive integer typeid pointer`), M.hasOwnProperty(e)) {
			if (n.ignoreDuplicateRegistrations) return;
			z(`Cannot register type '${r}' twice`);
		}
		if (M[e] = t, delete N[e], j.hasOwnProperty(e)) {
			var i = j[e];
			delete j[e], i.forEach((e) => e());
		}
	}
	function B(e, t) {
		return Be(e, t, arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {});
	}
	var Ve = (e, t, n, r) => {
		t = L(t), B(e, {
			name: t,
			fromWireType: function(e) {
				return !!e;
			},
			toWireType: function(e, t) {
				return t ? n : r;
			},
			readValueFromPointer: function(e) {
				return this.fromWireType(I[e]);
			},
			destructorFunction: null
		});
	}, He = (e) => ({
		count: e.count,
		deleteScheduled: e.deleteScheduled,
		preservePointerOnDelete: e.preservePointerOnDelete,
		ptr: e.ptr,
		ptrType: e.ptrType,
		smartPtr: e.smartPtr,
		smartPtrType: e.smartPtrType
	}), Ue = (e) => {
		function t(e) {
			return e.$$.ptrType.registeredClass.name;
		}
		z(t(e) + " instance already deleted");
	}, We = !1, Ge = (e) => {}, Ke = (e) => {
		e.smartPtr ? e.smartPtrType.rawDestructor(e.smartPtr) : e.ptrType.registeredClass.rawDestructor(e.ptr);
	}, qe = (e) => {
		--e.count.value, e.count.value === 0 && Ke(e);
	}, V = (e) => globalThis.FinalizationRegistry ? (We = new FinalizationRegistry((e) => {
		qe(e.$$);
	}), V = (e) => {
		var t = e.$$;
		if (t.smartPtr) {
			var n = { $$: t };
			We.register(e, n, e);
		}
		return e;
	}, Ge = (e) => We.unregister(e), V(e)) : (V = (e) => e, e), H = [], Je = () => {
		for (; H.length;) {
			var e = H.pop();
			e.$$.deleteScheduled = !1, e.delete();
		}
	}, Ye, Xe = () => {
		let e = U.prototype;
		Object.assign(e, {
			isAliasOf(e) {
				if (!(this instanceof U) || !(e instanceof U)) return !1;
				var t = this.$$.ptrType.registeredClass, n = this.$$.ptr;
				e.$$ = e.$$;
				for (var r = e.$$.ptrType.registeredClass, i = e.$$.ptr; t.baseClass;) n = t.upcast(n), t = t.baseClass;
				for (; r.baseClass;) i = r.upcast(i), r = r.baseClass;
				return t === r && n === i;
			},
			clone() {
				if (this.$$.ptr || Ue(this), this.$$.preservePointerOnDelete) return this.$$.count.value += 1, this;
				var e = V(Object.create(Object.getPrototypeOf(this), { $$: { value: He(this.$$) } }));
				return e.$$.count.value += 1, e.$$.deleteScheduled = !1, e;
			},
			delete() {
				this.$$.ptr || Ue(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && z("Object already scheduled for deletion"), Ge(this), qe(this.$$), this.$$.preservePointerOnDelete || (this.$$.smartPtr = void 0, this.$$.ptr = void 0);
			},
			isDeleted() {
				return !this.$$.ptr;
			},
			deleteLater() {
				return this.$$.ptr || Ue(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && z("Object already scheduled for deletion"), H.push(this), H.length === 1 && Ye && Ye(Je), this.$$.deleteScheduled = !0, this;
			}
		});
		let t = Symbol.dispose;
		t && (e[t] = e.delete);
	};
	function U() {}
	var Ze = (e, t) => Object.defineProperty(t, "name", { value: e }), Qe = {}, $e = (e, t, n) => {
		if (e[t].overloadTable === void 0) {
			var r = e[t];
			e[t] = function() {
				var r = [...arguments];
				return e[t].overloadTable.hasOwnProperty(r.length) || z(`Function '${n}' called with an invalid number of arguments (${r.length}) - expects one of (${e[t].overloadTable})!`), e[t].overloadTable[r.length].apply(this, r);
			}, e[t].overloadTable = [], e[t].overloadTable[r.argCount] = r;
		}
	}, et = (e, t, n) => {
		i.hasOwnProperty(e) ? ((n === void 0 || i[e].overloadTable !== void 0 && i[e].overloadTable[n] !== void 0) && z(`Cannot register public name '${e}' twice`), $e(i, e, e), i[e].overloadTable.hasOwnProperty(n) && z(`Cannot register multiple overloads of a function with the same number of arguments (${n})!`), i[e].overloadTable[n] = t) : (i[e] = t, i[e].argCount = n);
	}, tt = 48, nt = 57, rt = (e) => {
		e = e.replace(/[^a-zA-Z0-9_]/g, "$");
		var t = e.charCodeAt(0);
		return t >= tt && t <= nt ? `_${e}` : e;
	};
	function it(e, t, n, r, i, a, o, s) {
		this.name = e, this.constructor = t, this.instancePrototype = n, this.rawDestructor = r, this.baseClass = i, this.getActualType = a, this.upcast = o, this.downcast = s, this.pureVirtualFunctions = [];
	}
	var at = (e, t, n) => {
		for (; t !== n;) t.upcast || z(`Expected null or instance of ${n.name}, got an instance of ${t.name}`), e = t.upcast(e), t = t.baseClass;
		return e;
	}, ot = (e) => {
		if (e === null) return "null";
		var t = typeof e;
		return t === "object" || t === "array" || t === "function" ? e.toString() : "" + e;
	};
	function st(e, t) {
		if (t === null) return this.isReference && z(`null is not a valid ${this.name}`), 0;
		t.$$ || z(`Cannot pass "${ot(t)}" as a ${this.name}`), t.$$.ptr || z(`Cannot pass deleted object as a pointer of type ${this.name}`);
		var n = t.$$.ptrType.registeredClass;
		return at(t.$$.ptr, n, this.registeredClass);
	}
	function ct(e, t) {
		var n;
		if (t === null) return this.isReference && z(`null is not a valid ${this.name}`), this.isSmartPointer ? (n = this.rawConstructor(), e !== null && e.push(this.rawDestructor, n), n) : 0;
		(!t || !t.$$) && z(`Cannot pass "${ot(t)}" as a ${this.name}`), t.$$.ptr || z(`Cannot pass deleted object as a pointer of type ${this.name}`), !this.isConst && t.$$.ptrType.isConst && z(`Cannot convert argument of type ${t.$$.smartPtrType ? t.$$.smartPtrType.name : t.$$.ptrType.name} to parameter type ${this.name}`);
		var r = t.$$.ptrType.registeredClass;
		if (n = at(t.$$.ptr, r, this.registeredClass), this.isSmartPointer) switch (t.$$.smartPtr === void 0 && z("Passing raw pointer to smart pointer is illegal"), this.sharingPolicy) {
			case 0:
				t.$$.smartPtrType === this ? n = t.$$.smartPtr : z(`Cannot convert argument of type ${t.$$.smartPtrType ? t.$$.smartPtrType.name : t.$$.ptrType.name} to parameter type ${this.name}`);
				break;
			case 1:
				n = t.$$.smartPtr;
				break;
			case 2:
				if (t.$$.smartPtrType === this) n = t.$$.smartPtr;
				else {
					var i = t.clone();
					n = this.rawShare(n, J.toHandle(() => i.delete())), e !== null && e.push(this.rawDestructor, n);
				}
				break;
			default: z("Unsupported sharing policy");
		}
		return n;
	}
	function lt(e, t) {
		if (t === null) return this.isReference && z(`null is not a valid ${this.name}`), 0;
		t.$$ || z(`Cannot pass "${ot(t)}" as a ${this.name}`), t.$$.ptr || z(`Cannot pass deleted object as a pointer of type ${this.name}`), t.$$.ptrType.isConst && z(`Cannot convert argument of type ${t.$$.ptrType.name} to parameter type ${this.name}`);
		var n = t.$$.ptrType.registeredClass;
		return at(t.$$.ptr, n, this.registeredClass);
	}
	var ut = (e, t, n) => {
		if (t === n) return e;
		if (n.baseClass === void 0) return null;
		var r = ut(e, t, n.baseClass);
		return r === null ? null : n.downcast(r);
	}, dt = {}, ft = (e, t) => {
		for (t === void 0 && z("ptr should not be undefined"); e.baseClass;) t = e.upcast(t), e = e.baseClass;
		return t;
	}, pt = (e, t) => (t = ft(e, t), dt[t]), W = (e, t) => ((!t.ptrType || !t.ptr) && P("makeClassHandle requires ptr and ptrType"), !!t.smartPtrType != !!t.smartPtr && P("Both smartPtrType and smartPtr must be specified"), t.count = { value: 1 }, V(Object.create(e, { $$: {
		value: t,
		writable: !0
	} })));
	function mt(e) {
		var t = this.getPointee(e);
		if (!t) return this.destructor(e), null;
		var n = pt(this.registeredClass, t);
		if (n !== void 0) {
			if (n.$$.count.value === 0) return n.$$.ptr = t, n.$$.smartPtr = e, n.clone();
			var r = n.clone();
			return this.destructor(e), r;
		}
		function i() {
			return this.isSmartPointer ? W(this.registeredClass.instancePrototype, {
				ptrType: this.pointeeType,
				ptr: t,
				smartPtrType: this,
				smartPtr: e
			}) : W(this.registeredClass.instancePrototype, {
				ptrType: this,
				ptr: e
			});
		}
		var a = Qe[this.registeredClass.getActualType(t)];
		if (!a) return i.call(this);
		var o = this.isConst ? a.constPointerType : a.pointerType, s = ut(t, this.registeredClass, o.registeredClass);
		return s === null ? i.call(this) : this.isSmartPointer ? W(o.registeredClass.instancePrototype, {
			ptrType: o,
			ptr: s,
			smartPtrType: this,
			smartPtr: e
		}) : W(o.registeredClass.instancePrototype, {
			ptrType: o,
			ptr: s
		});
	}
	var ht = () => {
		Object.assign(gt.prototype, {
			getPointee(e) {
				return this.rawGetPointee && (e = this.rawGetPointee(e)), e;
			},
			destructor(e) {
				var t, n;
				(t = (n = this).rawDestructor) == null || t.call(n, e);
			},
			readValueFromPointer: A,
			fromWireType: mt
		});
	};
	function gt(e, t, n, r, i, a, o, s, c, l, u) {
		this.name = e, this.registeredClass = t, this.isReference = n, this.isConst = r, this.isSmartPointer = i, this.pointeeType = a, this.sharingPolicy = o, this.rawGetPointee = s, this.rawConstructor = c, this.rawShare = l, this.rawDestructor = u, !i && t.baseClass === void 0 ? r ? (this.toWireType = st, this.destructorFunction = null) : (this.toWireType = lt, this.destructorFunction = null) : this.toWireType = ct;
	}
	var _t = (e, t, n) => {
		i.hasOwnProperty(e) || P("Replacing nonexistent public symbol"), i[e].overloadTable !== void 0 && n !== void 0 ? i[e].overloadTable[n] = t : (i[e] = t, i[e].argCount = n);
	}, vt = {}, yt = (e, t, n) => {
		e = e.replace(/p/g, "i");
		var r = vt[e];
		return r(t, ...n);
	}, bt = function(e, t) {
		let n = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : [];
		if (arguments.length > 3 && arguments[3] !== void 0 && arguments[3], e.includes("j")) return yt(e, t, n);
		var r = w(t)(...n);
		function i(e) {
			return e;
		}
		return i(r);
	}, xt = function(e, t) {
		let n = arguments.length > 2 && arguments[2] !== void 0 && arguments[2];
		return function() {
			return bt(e, t, [...arguments], n);
		};
	}, G = function(e, t) {
		arguments.length > 2 && arguments[2] !== void 0 && arguments[2], e = L(e);
		function n() {
			return e.includes("j") ? xt(e, t) : w(t);
		}
		var r = n();
		return typeof r != "function" && z(`unknown function pointer with signature ${e}: ${t}`), r;
	};
	class St extends Error {}
	var Ct = (e) => {
		var t = Wn(e), n = L(t);
		return Q(t), n;
	}, K = (e, t) => {
		var n = [], r = {};
		function i(e) {
			if (!r[e] && !M[e]) {
				if (N[e]) {
					N[e].forEach(i);
					return;
				}
				n.push(e), r[e] = !0;
			}
		}
		throw t.forEach(i), new St(`${e}: ` + n.map(Ct).join([", "]));
	}, wt = (e, t, n, r, i, a, o, s, c, l, u, d, f) => {
		u = L(u), a = G(i, a), s && (s = G(o, s)), l && (l = G(c, l)), f = G(d, f);
		var p = rt(u);
		et(p, function() {
			K(`Cannot construct ${u} due to unbound types`, [r]);
		}), F([
			e,
			t,
			n
		], r ? [r] : [], (t) => {
			t = t[0];
			var n, i;
			r ? (n = t.registeredClass, i = n.instancePrototype) : i = U.prototype;
			var o = Ze(u, function() {
				var e = [...arguments];
				if (Object.getPrototypeOf(this) !== c) throw new R(`Use 'new' to construct ${u}`);
				if (d.constructor_body === void 0) throw new R(`${u} has no accessible constructor`);
				var t = d.constructor_body[e.length];
				if (t === void 0) throw new R(`Tried to invoke ctor of ${u} with invalid number of parameters (${e.length}) - expected (${Object.keys(d.constructor_body).toString()}) parameters instead!`);
				return t.apply(this, e);
			}), c = Object.create(i, { constructor: { value: o } });
			o.prototype = c;
			var d = new it(u, o, c, f, n, a, s, l);
			if (d.baseClass) {
				var m;
				(m = d.baseClass).__derivedClasses != null || (m.__derivedClasses = []), d.baseClass.__derivedClasses.push(d);
			}
			var h = new gt(u, d, !0, !1, !1), g = new gt(u + "*", d, !1, !1, !1), _ = new gt(u + " const*", d, !1, !0, !1);
			return Qe[e] = {
				pointerType: g,
				constPointerType: _
			}, _t(p, o), [
				h,
				g,
				_
			];
		});
	}, Tt = (e, t) => {
		for (var n = [], r = 0; r < e; r++) n.push(E[t + r * 4 >> 2]);
		return n;
	};
	function Et(e) {
		for (var t = 1; t < e.length; ++t) if (e[t] !== null && e[t].destructorFunction === void 0) return !0;
		return !1;
	}
	function Dt(e) {
		for (var t = 1; t < e.length; ++t) if (e[t] !== null && e[t].argStackAlloc) return !0;
		return !1;
	}
	function Ot(e, t, n, r, i, a) {
		var o = t.length;
		o < 2 && z("argTypes array size mismatch! Must at least get return value and receiver (this) types!");
		var s = t[1] !== null && n !== null, c = Et(t), l = Dt(t), u = l && !a && !c;
		l && !u && (c = !0);
		var d = !t[0].isVoid, f = o - 2, p = Array(f), m = [], h = [];
		return Ze(e, function() {
			var e = [...arguments];
			h.length = 0;
			var n;
			u && (n = C());
			var a, o;
			try {
				m.length = s ? 2 : 1, m[0] = i, s && (a = t[1].toWireType(h, this), m[1] = a);
				for (var l = 0; l < f; ++l) {
					var g = t[l + 2];
					p[l] = g.toWireType(u && g.argStackAlloc ? null : h, e[l]), m.push(p[l]);
				}
				o = r(...m);
			} finally {
				u && S(n);
			}
			function _(e) {
				if (c) Pe(h);
				else for (var n = s ? 1 : 2; n < t.length; n++) {
					var r = n === 1 ? a : p[n - 2];
					t[n].destructorFunction !== null && t[n].destructorFunction(r);
				}
				if (d) return t[0].fromWireType(e);
			}
			return _(o);
		});
	}
	var kt = (e, t, n, r, i, a) => {
		var o = Tt(t, n);
		i = G(r, i), F([], [e], (e) => {
			e = e[0];
			var n = `constructor ${e.name}`;
			if (e.registeredClass.constructor_body === void 0 && (e.registeredClass.constructor_body = []), e.registeredClass.constructor_body[t - 1] !== void 0) throw new R(`Cannot register multiple constructors with identical number of parameters (${t - 1}) for class '${e.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`);
			return e.registeredClass.constructor_body[t - 1] = () => {
				K(`Cannot construct ${e.name} due to unbound types`, o);
			}, F([], o, (r) => (r.splice(1, 0, null), e.registeredClass.constructor_body[t - 1] = Ot(n, r, null, i, a), [])), [];
		});
	}, At = (e) => {
		e = e.trim();
		let t = e.indexOf("(");
		return t === -1 ? e : e.slice(0, t);
	}, jt = (e, t, n, r, i, a, o, s, c, l) => {
		var u = Tt(n, r);
		t = L(t), t = At(t), a = G(i, a, c), F([], [e], (e) => {
			e = e[0];
			var r = `${e.name}.${t}`;
			t.startsWith("@@") && (t = Symbol[t.substring(2)]), s && e.registeredClass.pureVirtualFunctions.push(t);
			function i() {
				K(`Cannot call ${r} due to unbound types`, u);
			}
			var l = e.registeredClass.instancePrototype, d = l[t];
			return d === void 0 || d.overloadTable === void 0 && d.className !== e.name && d.argCount === n - 2 ? (i.argCount = n - 2, i.className = e.name, l[t] = i) : ($e(l, t, r), l[t].overloadTable[n - 2] = i), F([], u, (i) => {
				var s = Ot(r, i, e, a, o, c);
				return l[t].overloadTable === void 0 ? (s.argCount = n - 2, l[t] = s) : l[t].overloadTable[n - 2] = s, [];
			}), [];
		});
	}, Mt = [], q = [
		0,
		1,
		,
		1,
		null,
		1,
		!0,
		1,
		!1,
		1
	], Nt = [], Pt = (e) => {
		if (e > 9 && --q[e + 1] === 0) {
			var t = q[e];
			q[e] = void 0;
			var n = Nt[e];
			n && (Nt[e] = void 0, n(t)), Mt.push(e);
		}
	}, J = {
		toValue: (e) => (e || z(`Cannot use deleted val. handle = ${e}`), q[e]),
		toHandle: (e) => {
			switch (e) {
				case void 0: return 2;
				case null: return 4;
				case !0: return 6;
				case !1: return 8;
				default: {
					let t = Mt.pop() || q.length;
					return q[t] = e, q[t + 1] = 1, t;
				}
			}
		}
	}, Ft = {
		name: "emscripten::val",
		fromWireType: (e) => {
			var t = J.toValue(e);
			return Pt(e), t;
		},
		toWireType: (e, t) => J.toHandle(t),
		readValueFromPointer: A,
		destructorFunction: null
	}, It = (e) => B(e, Ft), Lt, Rt, zt = (e, t) => {
		switch (t) {
			case 4: return function(e) {
				return this.fromWireType(Lt[e >> 2]);
			};
			case 8: return function(e) {
				return this.fromWireType(Rt[e >> 3]);
			};
			default: throw TypeError(`invalid float width (${t}): ${e}`);
		}
	}, Bt = (e, t, n) => {
		t = L(t), B(e, {
			name: t,
			fromWireType: (e) => e,
			toWireType: (e, t) => t,
			readValueFromPointer: zt(t, n),
			destructorFunction: null
		});
	}, Vt = (e, t, n, r, i, a, o, s) => {
		var c = Tt(t, n);
		e = L(e), e = At(e), i = G(r, i, o), et(e, function() {
			K(`Cannot call ${e} due to unbound types`, c);
		}, t - 1), F([], c, (n) => {
			var r = [n[0], null].concat(n.slice(1));
			return _t(e, Ot(e, r, null, i, a, o), t - 1), [];
		});
	}, Ht, Y, Ut, Wt = (e, t, n) => {
		switch (t) {
			case 1: return n ? (e) => y[e] : (e) => I[e];
			case 2: return n ? (e) => Ht[e >> 1] : (e) => Y[e >> 1];
			case 4: return n ? (e) => Ut[e >> 2] : (e) => E[e >> 2];
			default: throw TypeError(`invalid integer width (${t}): ${e}`);
		}
	}, Gt = (e, t, n, r, i) => {
		t = L(t);
		let a = r === 0, o = (e) => e;
		if (a) {
			var s = 32 - 8 * n;
			o = (e) => e << s >>> s, i = o(i);
		}
		B(e, {
			name: t,
			fromWireType: o,
			toWireType: (e, t) => t,
			readValueFromPointer: Wt(t, n, r !== 0),
			destructorFunction: null
		});
	}, Kt = (e, t, n) => {
		let r = (e, t) => {
			let n = 0;
			return {
				next() {
					if (n >= e) return { done: !0 };
					let r = n;
					return n++, {
						value: t(r),
						done: !1
					};
				},
				[Symbol.iterator]() {
					return this;
				}
			};
		};
		e[Symbol.iterator] || (e[Symbol.iterator] = function() {
			let e = this[t]();
			return r(e, (e) => this[n](e));
		});
	}, qt = (e, t, n, r) => {
		n = L(n), r = L(r), F([], [e, t], (e) => {
			let t = e[0];
			return Kt(t.registeredClass.instancePrototype, n, r), [];
		});
	}, Jt = (e, t, n) => {
		var r = [
			Int8Array,
			Uint8Array,
			Int16Array,
			Uint16Array,
			Int32Array,
			Uint32Array,
			Float32Array,
			Float64Array
		][t];
		function i(e) {
			var t = E[e >> 2], n = E[e + 4 >> 2];
			return new r(y.buffer, n, t);
		}
		n = L(n), B(e, {
			name: n,
			fromWireType: i,
			readValueFromPointer: i
		}, { ignoreDuplicateRegistrations: !0 });
	}, Yt = Object.assign({ optional: !0 }, Ft), Xt = (e, t) => {
		B(e, Yt);
	}, Zt = (e, t, n, r) => {
		if (!(r > 0)) return 0;
		for (var i = n, a = n + r - 1, o = 0; o < e.length; ++o) {
			var s = e.codePointAt(o);
			if (s <= 127) {
				if (n >= a) break;
				t[n++] = s;
			} else if (s <= 2047) {
				if (n + 1 >= a) break;
				t[n++] = 192 | s >> 6, t[n++] = 128 | s & 63;
			} else if (s <= 65535) {
				if (n + 2 >= a) break;
				t[n++] = 224 | s >> 12, t[n++] = 128 | s >> 6 & 63, t[n++] = 128 | s & 63;
			} else {
				if (n + 3 >= a) break;
				t[n++] = 240 | s >> 18, t[n++] = 128 | s >> 12 & 63, t[n++] = 128 | s >> 6 & 63, t[n++] = 128 | s & 63, o++;
			}
		}
		return t[n] = 0, n - i;
	}, Qt = (e, t, n) => Zt(e, I, t, n), $t = (e) => {
		for (var t = 0, n = 0; n < e.length; ++n) {
			var r = e.charCodeAt(n);
			r <= 127 ? t++ : r <= 2047 ? t += 2 : r >= 55296 && r <= 57343 ? (t += 4, ++n) : t += 3;
		}
		return t;
	}, en = globalThis.TextDecoder && new TextDecoder(), tn = (e, t, n, r) => {
		var i = t + n;
		if (r) return i;
		for (; e[t] && !(t >= i);) ++t;
		return t;
	}, nn = function(e) {
		let t = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0, n = arguments.length > 2 ? arguments[2] : void 0, r = arguments.length > 3 ? arguments[3] : void 0;
		var i = tn(e, t, n, r);
		if (i - t > 16 && e.buffer && en) return en.decode(e.subarray(t, i));
		for (var a = ""; t < i;) {
			var o = e[t++];
			if (!(o & 128)) {
				a += String.fromCharCode(o);
				continue;
			}
			var s = e[t++] & 63;
			if ((o & 224) == 192) {
				a += String.fromCharCode((o & 31) << 6 | s);
				continue;
			}
			var c = e[t++] & 63;
			if (o = (o & 240) == 224 ? (o & 15) << 12 | s << 6 | c : (o & 7) << 18 | s << 12 | c << 6 | e[t++] & 63, o < 65536) a += String.fromCharCode(o);
			else {
				var l = o - 65536;
				a += String.fromCharCode(55296 | l >> 10, 56320 | l & 1023);
			}
		}
		return a;
	}, rn = (e, t, n) => e ? nn(I, e, t, n) : "", an = (e, t) => {
		t = L(t);
		var n = !0;
		B(e, {
			name: t,
			fromWireType(e) {
				var t = E[e >> 2], r = e + 4, i;
				if (n) i = rn(r, t, !0);
				else {
					i = "";
					for (var a = 0; a < t; ++a) i += String.fromCharCode(I[r + a]);
				}
				return Q(e), i;
			},
			toWireType(e, t) {
				t instanceof ArrayBuffer && (t = new Uint8Array(t));
				var r, i = typeof t == "string";
				i || ArrayBuffer.isView(t) && t.BYTES_PER_ELEMENT == 1 || z("Cannot pass non-string to std::string"), r = n && i ? $t(t) : t.length;
				var a = Gn(4 + r + 1), o = a + 4;
				if (E[a >> 2] = r, i) {
					if (n) Qt(t, o, r + 1);
					else for (var s = 0; s < r; ++s) {
						var c = t.charCodeAt(s);
						c > 255 && (Q(a), z("String has UTF-16 code units that do not fit in 8 bits")), I[o + s] = c;
					}
				} else I.set(t, o);
				return e !== null && e.push(Q, a), a;
			},
			readValueFromPointer: A,
			destructorFunction(e) {
				Q(e);
			}
		});
	}, on = globalThis.TextDecoder ? new TextDecoder("utf-16le") : void 0, sn = (e, t, n) => {
		var r = e >> 1, i = tn(Y, r, t / 2, n);
		if (i - r > 16 && on) return on.decode(Y.subarray(r, i));
		for (var a = "", o = r; o < i; ++o) {
			var s = Y[o];
			a += String.fromCharCode(s);
		}
		return a;
	}, cn = function(e, t) {
		let n = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : 2147483647;
		if (n < 2) return 0;
		n -= 2;
		for (var r = t, i = n < e.length * 2 ? n / 2 : e.length, a = 0; a < i; ++a) {
			var o = e.charCodeAt(a);
			Ht[t >> 1] = o, t += 2;
		}
		return Ht[t >> 1] = 0, t - r;
	}, ln = (e) => e.length * 2, un = (e, t, n) => {
		for (var r = "", i = e >> 2, a = 0; !(a >= t / 4); a++) {
			var o = E[i + a];
			if (!o && !n) break;
			r += String.fromCodePoint(o);
		}
		return r;
	}, dn = function(e, t) {
		let n = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : 2147483647;
		if (n < 4) return 0;
		for (var r = t, i = r + n - 4, a = 0; a < e.length; ++a) {
			var o = e.codePointAt(a);
			if (o > 65535 && a++, Ut[t >> 2] = o, t += 4, t + 4 > i) break;
		}
		return Ut[t >> 2] = 0, t - r;
	}, fn = (e) => {
		for (var t = 0, n = 0; n < e.length; ++n) e.codePointAt(n) > 65535 && n++, t += 4;
		return t;
	}, pn = (e, t, n) => {
		n = L(n);
		var r, i, a;
		t === 2 ? (r = sn, i = cn, a = ln) : (r = un, i = dn, a = fn), B(e, {
			name: n,
			fromWireType: (e) => {
				var n = E[e >> 2], i = r(e + 4, n * t, !0);
				return Q(e), i;
			},
			toWireType: (e, r) => {
				typeof r != "string" && z(`Cannot pass non-string to C++ string type ${n}`);
				var o = a(r), s = Gn(4 + o + t);
				return E[s >> 2] = o / t, i(r, s + 4, o + t), e !== null && e.push(Q, s), s;
			},
			readValueFromPointer: A,
			destructorFunction(e) {
				Q(e);
			}
		});
	}, mn = (e, t, n, r, i, a, o, s) => {
		k[e] = {
			name: L(t),
			rawConstructor: G(n, r),
			rawDestructor: G(i, a),
			valueSize: o,
			isTrivial: !!s,
			fields: []
		};
	}, hn = (e, t, n, r, i, a, o, s, c, l) => {
		k[e].fields.push({
			fieldName: L(t),
			getterReturnType: n,
			getter: G(r, i),
			getterContext: a,
			setterArgumentType: o,
			setter: G(s, c),
			setterContext: l
		});
	}, gn = (e, t) => {
		t = L(t), B(e, {
			isVoid: !0,
			name: t,
			fromWireType: () => void 0,
			toWireType: (e, t) => void 0
		});
	}, _n = 0, vn = () => {
		_e = !1, _n = 0;
	}, yn = [], bn = (e) => {
		var t = yn.length;
		return yn.push(e), t;
	}, xn = (e, t) => {
		var n = M[e];
		return n === void 0 && z(`${t} has unknown type ${Ct(e)}`), n;
	}, Sn = (e, t) => {
		for (var n = Array(e), r = 0; r < e; ++r) n[r] = xn(E[t + r * 4 >> 2], `parameter ${r}`);
		return n;
	}, Cn = (e, t, n) => {
		var r = [], i = e(r, n);
		return r.length && (E[t >> 2] = J.toHandle(r)), i;
	}, wn = {}, Tn = (e) => {
		var t = wn[e];
		return t === void 0 ? L(e) : t;
	}, En = (e, t, n) => {
		var [r, ...i] = Sn(e, t), a = r.toWireType.bind(r), o = i.map((e) => e.readValueFromPointer.bind(e));
		e--;
		var s = Array(e);
		return bn(Ze(`methodCaller<(${i.map((e) => e.name)}) => ${r.name}>`, (t, r, i, c) => {
			for (var l = 0, u = 0; u < e; ++u) s[u] = o[u](c + l), l += 8;
			var d;
			switch (n) {
				case 0:
					d = J.toValue(t).apply(null, s);
					break;
				case 2:
					d = Reflect.construct(J.toValue(t), s);
					break;
				case 3:
					d = s[0];
					break;
				case 1: d = J.toValue(t)[Tn(r)](...s);
			}
			return Cn(a, i, d);
		}));
	}, Dn = (e) => e ? (e = Tn(e), J.toHandle(globalThis[e])) : J.toHandle(globalThis), On = (e) => {
		e > 9 && (q[e + 1] += 1);
	}, kn = (e, t, n, r, i) => yn[e](t, n, r, i), An = (e) => {
		Pe(J.toValue(e)), Pt(e);
	}, X = {}, jn = (e) => {
		if (e instanceof me || e == "unwind") return g;
		s(1, e);
	}, Mn = () => _e || _n > 0, Nn = (e) => {
		if (g = e, !Mn()) {
			var t;
			(t = i.onExit) == null || t.call(i, e), h = !0;
		}
		s(e, new me(e));
	}, Pn = (e, t) => {
		g = e, Nn(e);
	}, Fn = () => {
		if (!Mn()) try {
			Pn(g);
		} catch (e) {
			jn(e);
		}
	}, In = function(e) {
		var t = [...arguments].slice(1);
		if (!h) try {
			return e(...t);
		} catch (e) {
			jn(e);
		} finally {
			Fn();
		}
	}, Ln = () => performance.now(), Rn = (e, t) => (X[e] && (clearTimeout(X[e].id), delete X[e]), t && (X[e] = {
		id: setTimeout(() => {
			delete X[e], In(qn, e, Ln());
		}, t),
		timeout_ms: t
	}), 0), zn = () => 2147483648, Bn = (e, t) => Math.ceil(e / t) * t, Vn = (e) => {
		var t = (e - nr.buffer.byteLength + 65535) / 65536 | 0;
		try {
			return nr.grow(t), ne(), 1;
		} catch {}
	}, Hn = (e) => {
		var t = I.length;
		e >>>= 0;
		var n = zn();
		if (e > n) return !1;
		for (var r = 1; r <= 4; r *= 2) {
			var i = t * (1 + .2 / r);
			if (i = Math.min(i, e + 100663296), Vn(Math.min(n, Bn(Math.max(e, i), 65536)))) return !0;
		}
		return !1;
	}, Un = (e) => e;
	Xe(), ht(), i.noExitRuntime && (_e = i.noExitRuntime), i.print && i.print, i.printErr && (p = i.printErr), i.wasmBinary && (m = i.wasmBinary), i.arguments && i.arguments, i.thisProgram && i.thisProgram;
	var Z = i.preInit;
	if (Z) for (typeof Z == "function" && (i.preInit = Z = [Z]); Z.length > 0;) Z.shift()();
	var Wn, Gn, Q, Kn, qn, $, Jn, Yn, Xn, Zn, Qn, $n, er, tr, nr, rr;
	function ir(e) {
		Wn = e.sa, Gn = i._malloc = e.ta, Q = i._free = e.ua, Kn = e.va, qn = e.xa, $ = e.ya, Jn = e.za, Yn = e.Aa, Xn = e.Ba, Zn = e.Ca, Qn = e.Da, $n = e.Ea, er = e.Fa, tr = vt.iiij = e.Ga, nr = e.qa, rr = e.wa;
	}
	var ar = {
		aa: ye,
		v: Se,
		I: Ce,
		a: Te,
		i: Ee,
		l: De,
		fa: ke,
		s: Ae,
		e: Me,
		ea: Ne,
		T: Re,
		W: ze,
		ia: Ve,
		pa: wt,
		oa: kt,
		E: jt,
		ga: It,
		Q: Bt,
		R: Vt,
		y: Gt,
		ka: qt,
		u: Jt,
		S: Xt,
		ha: an,
		L: pn,
		C: mn,
		U: hn,
		ja: gn,
		da: vn,
		na: En,
		ba: Pt,
		B: Dn,
		P: On,
		ma: kn,
		la: An,
		_: Rn,
		$: Hn,
		Z: Tr,
		N: Or,
		A: mr,
		b: sr,
		z: Dr,
		g: cr,
		D: wr,
		h: pr,
		k: xr,
		o: br,
		K: Er,
		O: Cr,
		H: fr,
		G: Mr,
		V: Ir,
		c: ur,
		j: or,
		X: Nr,
		f: dr,
		M: Ar,
		J: Fr,
		d: lr,
		F: Pr,
		m: gr,
		Y: jr,
		n: yr,
		t: vr,
		x: Sr,
		q: _r,
		r: kr,
		p: hr,
		w: Un,
		ca: Nn
	};
	function or(e, t) {
		var n = C();
		try {
			w(e)(t);
		} catch (e) {
			if (S(n), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function sr(e, t) {
		var n = C();
		try {
			return w(e)(t);
		} catch (e) {
			if (S(n), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function cr(e, t, n) {
		var r = C();
		try {
			return w(e)(t, n);
		} catch (e) {
			if (S(r), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function lr(e, t, n, r) {
		var i = C();
		try {
			w(e)(t, n, r);
		} catch (e) {
			if (S(i), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function ur(e) {
		var t = C();
		try {
			w(e)();
		} catch (e) {
			if (S(t), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function dr(e, t, n) {
		var r = C();
		try {
			w(e)(t, n);
		} catch (e) {
			if (S(r), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function fr(e, t, n, r, i, a, o, s) {
		var c = C();
		try {
			return w(e)(t, n, r, i, a, o, s);
		} catch (e) {
			if (S(c), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function pr(e, t, n, r) {
		var i = C();
		try {
			return w(e)(t, n, r);
		} catch (e) {
			if (S(i), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function mr(e, t, n, r, i, a) {
		var o = C();
		try {
			return w(e)(t, n, r, i, a);
		} catch (e) {
			if (S(o), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function hr(e, t, n, r, i, a, o, s, c, l, u) {
		var d = C();
		try {
			w(e)(t, n, r, i, a, o, s, c, l, u);
		} catch (e) {
			if (S(d), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function gr(e, t, n, r, i) {
		var a = C();
		try {
			w(e)(t, n, r, i);
		} catch (e) {
			if (S(a), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function _r(e, t, n, r, i, a, o, s, c) {
		var l = C();
		try {
			w(e)(t, n, r, i, a, o, s, c);
		} catch (e) {
			if (S(l), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function vr(e, t, n, r, i, a, o) {
		var s = C();
		try {
			w(e)(t, n, r, i, a, o);
		} catch (e) {
			if (S(s), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function yr(e, t, n, r, i, a) {
		var o = C();
		try {
			w(e)(t, n, r, i, a);
		} catch (e) {
			if (S(o), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function br(e, t, n, r, i, a) {
		var o = C();
		try {
			return w(e)(t, n, r, i, a);
		} catch (e) {
			if (S(o), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function xr(e, t, n, r, i) {
		var a = C();
		try {
			return w(e)(t, n, r, i);
		} catch (e) {
			if (S(a), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function Sr(e, t, n, r, i, a, o, s) {
		var c = C();
		try {
			w(e)(t, n, r, i, a, o, s);
		} catch (e) {
			if (S(c), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function Cr(e, t, n, r, i, a, o) {
		var s = C();
		try {
			return w(e)(t, n, r, i, a, o);
		} catch (e) {
			if (S(s), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function wr(e, t, n, r, i) {
		var a = C();
		try {
			return w(e)(t, n, r, i);
		} catch (e) {
			if (S(a), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function Tr(e, t, n) {
		var r = C();
		try {
			return w(e)(t, n);
		} catch (e) {
			if (S(r), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function Er(e, t, n, r, i, a, o) {
		var s = C();
		try {
			return w(e)(t, n, r, i, a, o);
		} catch (e) {
			if (S(s), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function Dr(e, t, n, r) {
		var i = C();
		try {
			return w(e)(t, n, r);
		} catch (e) {
			if (S(i), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function Or(e, t, n, r) {
		var i = C();
		try {
			return w(e)(t, n, r);
		} catch (e) {
			if (S(i), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function kr(e, t, n, r, i, a, o, s, c, l) {
		var u = C();
		try {
			w(e)(t, n, r, i, a, o, s, c, l);
		} catch (e) {
			if (S(u), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function Ar(e, t, n, r, i, a, o, s, c) {
		var l = C();
		try {
			w(e)(t, n, r, i, a, o, s, c);
		} catch (e) {
			if (S(l), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function jr(e, t, n, r, i, a, o, s) {
		var c = C();
		try {
			w(e)(t, n, r, i, a, o, s);
		} catch (e) {
			if (S(c), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function Mr(e, t, n, r, i, a, o, s, c) {
		var l = C();
		try {
			return w(e)(t, n, r, i, a, o, s, c);
		} catch (e) {
			if (S(l), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function Nr(e, t, n) {
		var r = C();
		try {
			w(e)(t, n);
		} catch (e) {
			if (S(r), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function Pr(e, t, n, r, i, a, o) {
		var s = C();
		try {
			w(e)(t, n, r, i, a, o);
		} catch (e) {
			if (S(s), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function Fr(e, t, n, r, i) {
		var a = C();
		try {
			w(e)(t, n, r, i);
		} catch (e) {
			if (S(a), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	function Ir(e, t, n, r, i) {
		var a = C();
		try {
			return tr(e, t, n, r, i);
		} catch (e) {
			if (S(a), !(e instanceof _)) throw e;
			$(1, 0);
		}
	}
	async function Lr() {
		var e;
		re();
		var t = i.setStatus;
		t && (t("Running..."), await new Promise((e) => setTimeout(e, 1)), setTimeout(t, 1, "")), !h && (ie(), (e = i.onRuntimeInitialized) == null || e.call(i), ae());
	}
	var Rr = await pe();
	return await Lr(), i;
}
//#endregion
//#region src/reader/index.ts
function x(e) {
	return m(b, e);
}
function ge() {
	return se(b);
}
function _e(e) {
	return x({
		overrides: e,
		equalityFn: Object.is,
		fireImmediately: !0
	});
}
function S(e) {
	x({
		overrides: e,
		equalityFn: Object.is,
		fireImmediately: !1
	});
}
async function C(e, t) {
	return ue(b, e, t);
}
async function ve(e, t) {
	return C(e, t);
}
async function w(e, t) {
	return C(e, t);
}
var ye = "5003fb4b88c4fbd1fd518a2fd8c8ad365c519e183a08c03a322dddfea3cea84e";
//#endregion
export { y as BARCODE_FORMATS, h as BARCODE_HRI_LABELS, me as BARCODE_META_FORMATS, d as BARCODE_SYMBOLOGIES, p as BINARIZERS, te as CHARACTER_SETS, ce as CONTENT_TYPES, t as CREATABLE_BARCODE_FORMATS, g as EAN_ADD_ON_SYMBOLS, pe as GS1_BARCODE_FORMATS, f as INDUSTRIAL_BARCODE_FORMATS, r as LINEAR_BARCODE_FORMATS, n as MATRIX_BARCODE_FORMATS, l as READABLE_BARCODE_FORMATS, ie as RETAIL_BARCODE_FORMATS, ae as TEXT_MODES, le as ZXING_CPP_COMMIT, ye as ZXING_WASM_SHA256, ne as ZXING_WASM_VERSION, e as barcodeFormats, fe as binarizers, ee as characterSets, oe as contentTypes, v as defaultReaderOptions, _ as eanAddOnSymbols, re as encodeFormat, s as encodeFormats, c as formatToLabel, u as formatToSymbology, _e as getZXingModule, i as linearBarcodeFormats, a as matrixBarcodeFormats, x as prepareZXingModule, ge as purgeZXingModule, C as readBarcodes, w as readBarcodesFromImageData, ve as readBarcodesFromImageFile, S as setZXingModuleOverrides, o as symbologyToFormats, de as textModes };
