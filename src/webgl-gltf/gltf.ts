import { mat4, quat, vec3, vec4 } from 'gl-matrix';
import { applyRotationFromQuat, createMat4FromArray } from './mat';
import * as gltf from './types/gltf';
import { Animation, Channel, GLBuffer, KeyFrame, Material, Mesh, Model, Node, Skin } from './types/model';

type GLContext = WebGLRenderingContext | WebGL2RenderingContext;

const accessorSizes = {
    'SCALAR': 1,
    'VEC2': 2,
    'VEC3': 3,
    'VEC4': 4,
    'MAT2': 4,
    'MAT3': 9,
    'MAT4': 16
};

export enum BufferType {
    Byte = 5120,
    UnsignedByte = 5121,
    Short = 5122,
    UnsignedShort = 5123,
    UnsignedInt = 5125,
    Float = 5126,
}

const componentByteSize = {
    [BufferType.Byte]: 1,
    [BufferType.UnsignedByte]: 1,
    [BufferType.Short]: 2,
    [BufferType.UnsignedShort]: 2,
    [BufferType.UnsignedInt]: 4,
    [BufferType.Float]: 4,
} as const;

const glTypeToTypedArray = (componentType: BufferType) => {
    switch (componentType) {
        case BufferType.Byte:
            return Int8Array;
        case BufferType.UnsignedByte:
            return Uint8Array;
        case BufferType.Short:
            return Int16Array;
        case BufferType.UnsignedShort:
            return Uint16Array;
        case BufferType.UnsignedInt:
            return Uint32Array;
        case BufferType.Float:
        default:
            return Float32Array;
    }
};

export interface Buffer {
    data: Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array;
    size: number;
    type: string;
    target: number;
    componentType: BufferType;
    glBuffer: WebGLBuffer;
}

const resolveEmbeddedBuffer = (uri: string): string => {
    const content = uri.split(',')[1];
    const binaryData = atob(content);
    const arrayBuffer = new ArrayBuffer(binaryData.length);
    const uint8Array = new Uint8Array(arrayBuffer);

    for (let i = 0; i < binaryData.length; i++) {
        uint8Array[i] = binaryData.charCodeAt(i);
    }

    const blob = new Blob([uint8Array], { type: 'application/octet-stream' }); // Crea un Blob
    return URL.createObjectURL(blob);
}

const EMBEDDED_DATA_REGEXP = /(.*)data:(.*?)(;base64)?,(.*)$/;

const getBuffer = async (path: string, buffer: string) => {
    const dir = path.split('/').slice(0, -1).join('/');
    const finalPath = EMBEDDED_DATA_REGEXP.test(buffer) ? resolveEmbeddedBuffer(buffer) : `${dir}/${buffer}`;
    const response = await fetch(finalPath);
    return await response.arrayBuffer();
};

const getTexture = async (gl: GLContext, uri: string) => {
    return new Promise<WebGLTexture>(resolve => {
        const img = new Image();
        img.onload = () => {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            const ext = gl.getExtension('EXT_texture_filter_anisotropic');
            if (ext) {
                const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
                gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, max);
            }

            gl.generateMipmap(gl.TEXTURE_2D);
            resolve(texture!);
        }
        img.src = EMBEDDED_DATA_REGEXP.test(uri) ? resolveEmbeddedBuffer(uri) : uri;
        img.crossOrigin = 'undefined';
    });
};

const readBufferFromFile = (gltf: gltf.GlTf, buffers: ArrayBuffer[], accessor: gltf.Accessor) => {
    const bufferView = gltf.bufferViews![accessor.bufferView as number];
    const size = accessorSizes[accessor.type];
    const componentType = accessor.componentType as BufferType;
    const type = accessor.type;
    const byteOffset = (accessor.byteOffset || 0) + (bufferView.byteOffset || 0);
    const length = accessor.count * size;
    const byteStride = bufferView.byteStride || size * componentByteSize[componentType];
    const elementSize = size * componentByteSize[componentType];
    let data: Buffer['data'];

    if (byteStride !== elementSize) {
        const buffer = buffers[bufferView.buffer];
        const view = new DataView(buffer, byteOffset);
        const total = length;
        const TypedArray = glTypeToTypedArray(componentType);
        const interleaved = new TypedArray(total);
        for (let i = 0; i < accessor.count; i++) {
            const base = i * byteStride;
            for (let c = 0; c < size; c++) {
                const offset = base + c * componentByteSize[componentType];
                const index = i * size + c;
                switch (componentType) {
                    case BufferType.Byte:
                        interleaved[index] = view.getInt8(offset);
                        break;
                    case BufferType.UnsignedByte:
                        interleaved[index] = view.getUint8(offset);
                        break;
                    case BufferType.Short:
                        interleaved[index] = view.getInt16(offset, true);
                        break;
                    case BufferType.UnsignedShort:
                        interleaved[index] = view.getUint16(offset, true);
                        break;
                    case BufferType.UnsignedInt:
                        interleaved[index] = view.getUint32(offset, true);
                        break;
                    case BufferType.Float:
                    default:
                        interleaved[index] = view.getFloat32(offset, true);
                        break;
                }
            }
        }

        return {
            size,
            data: interleaved,
            type,
            componentType,
            target: bufferView.target
        } as Buffer;
    }

    switch (componentType) {
        case BufferType.Byte:
            data = new Int8Array(buffers[bufferView.buffer], byteOffset, length);
            break;
        case BufferType.UnsignedByte:
            data = new Uint8Array(buffers[bufferView.buffer], byteOffset, length);
            break;
        case BufferType.Short:
            data = new Int16Array(buffers[bufferView.buffer], byteOffset, length);
            break;
        case BufferType.UnsignedShort:
            data = new Uint16Array(buffers[bufferView.buffer], byteOffset, length);
            break;
        case BufferType.UnsignedInt:
            data = new Uint32Array(buffers[bufferView.buffer], byteOffset, length);
            break;
        case BufferType.Float:
        default:
            data = new Float32Array(buffers[bufferView.buffer], byteOffset, length);
            break;
    }

    return {
        size,
        data,
        type,
        componentType,
        target: bufferView.target
    } as Buffer;
};

const getAccessor = (gltf: gltf.GlTf, mesh: gltf.Mesh, attributeName: string) => {
    const attribute = mesh.primitives[0].attributes[attributeName];
    return gltf.accessors![attribute];
};

const getBufferFromName = (gl: GLContext, gltf: gltf.GlTf, buffers: ArrayBuffer[], mesh: gltf.Mesh, name: string) => {
    if (mesh.primitives[0].attributes[name] === undefined) {
        return null;
    }

    const accessor = getAccessor(gltf, mesh, name);
    const bufferData = readBufferFromFile(gltf, buffers, accessor);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, bufferData.data, gl.STATIC_DRAW);

    return {
        buffer,
        size: bufferData.size,
        type: bufferData.componentType,
        target: bufferData.target
    } as GLBuffer;
};

const loadNodes = (index: number, node: gltf.Node): Node => {
    const transform = mat4.create();

    if (node.translation !== undefined) mat4.translate(transform, transform, vec3.fromValues(node.translation[0], node.translation[1], node.translation[1]));
    if (node.rotation !== undefined) applyRotationFromQuat(transform, node.rotation);
    if (node.scale !== undefined) mat4.scale(transform, transform, vec3.fromValues(node.scale[0], node.scale[1], node.scale[1]));
    if (node.matrix !== undefined) createMat4FromArray(node.matrix);

    return {
        id: index,
        name: node.name,
        children: node.children || [],
        localBindTransform: transform,
        animatedTransform: mat4.create(),
        skin: node.skin,
        mesh: node.mesh,
        matrix: node.matrix
    } as Node;
};

const loadAnimation = (gltf: gltf.GlTf, animation: gltf.Animation, buffers: ArrayBuffer[]) => {
    const channels = animation.channels.map(c => {
        const sampler = animation.samplers[c.sampler];
        const time = readBufferFromFile(gltf, buffers, gltf.accessors![sampler.input]);
        const buffer = readBufferFromFile(gltf, buffers, gltf.accessors![sampler.output]);

        return {
            node: c.target.node,
            type: c.target.path,
            time,
            buffer,
            interpolation: sampler.interpolation ? sampler.interpolation : 'LINEAR',
        };
    });

    const c: Channel = {};
    channels.forEach((channel) => {
        if (c[channel.node!] === undefined) {
            c[channel.node!] = {
                translation: [],
                rotation: [],
                scale: [],
            };
        }

        for (let i = 0; i < channel.time.data.length; i++) {
            const size = channel.interpolation === 'CUBICSPLINE' ? channel.buffer.size * 3 : channel.buffer.size;
            const offset = channel.interpolation === 'CUBICSPLINE' ? channel.buffer.size : 0;

            const transform = channel.type === 'rotation'
                ? quat.fromValues(
                    channel.buffer.data[i * size + offset],
                    channel.buffer.data[i * size + offset + 1],
                    channel.buffer.data[i * size + offset + 2],
                    channel.buffer.data[i * size + offset + 3]
                )
                : vec3.fromValues(
                    channel.buffer.data[i * size + offset],
                    channel.buffer.data[i * size + offset + 1],
                    channel.buffer.data[i * size + offset + 2]
                );

            c[channel.node!][channel.type].push({
                time: channel.time.data[i],
                transform: transform,
                type: channel.type,
            } as KeyFrame)
        }
    });

    return c;
};

const loadMesh = (gl: GLContext, gltf: gltf.GlTf, mesh: gltf.Mesh, buffers: ArrayBuffer[]) => {
    let indices: GLBuffer | null = null;
    let elementCount = 0;

    if (mesh.primitives[0].indices !== undefined) {
        const indexAccessor = gltf.accessors![mesh.primitives[0].indices!];
        const indexBuffer = readBufferFromFile(gltf, buffers, indexAccessor);

        const buffer = gl.createBuffer() as WebGLBuffer;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.data, gl.STATIC_DRAW);

        indices = {
            buffer,
            size: indexBuffer.size,
            type: indexBuffer.componentType,
            target: gl.ELEMENT_ARRAY_BUFFER
        }


        elementCount = indexBuffer.data.length;
    } else {
        const accessor = getAccessor(gltf, mesh, 'POSITION');
        elementCount = accessor.count;
    }

    return {
        name: mesh.name,
        indices,
        elementCount,
        positions: getBufferFromName(gl, gltf, buffers, mesh, 'POSITION'),
        normals: getBufferFromName(gl, gltf, buffers, mesh, 'NORMAL'),
        tangents: getBufferFromName(gl, gltf, buffers, mesh, 'TANGENT'),
        texCoord: getBufferFromName(gl, gltf, buffers, mesh, 'TEXCOORD_0'),
        joints: getBufferFromName(gl, gltf, buffers, mesh, 'JOINTS_0'),
        weights: getBufferFromName(gl, gltf, buffers, mesh, 'WEIGHTS_0'),
        material: mesh.primitives[0].material,
    } as Mesh;
};

const loadMaterial = async (gl: GLContext, material: gltf.Material, path: string, images?: gltf.Image[]): Promise<Material> => {
    const dir = path.split('/').slice(0, -1).join('/');

    let baseColorTexture: WebGLTexture | null = null;
    let metallicRoughnessTexture: WebGLTexture | null = null;
    let emissiveTexture: WebGLTexture | null = null;
    let normalTexture: WebGLTexture | null = null;
    let occlusionTexture: WebGLTexture | null = null;

    let baseColorFactor = vec4.fromValues(1.0, 1.0, 1.0, 1.0);
    let roughnessFactor = 0.0;
    let metallicFactor = 1.0;
    let emissiveFactor = vec3.fromValues(1.0, 1.0, 1.0);

    const pbr = material.pbrMetallicRoughness;
    if (pbr) {
        if (pbr.baseColorTexture) {
            const uri = images![pbr.baseColorTexture.index].uri!;
            baseColorTexture = await getTexture(gl, `${dir}/${uri}`);
        }
        if (pbr.baseColorFactor) {
            baseColorFactor = vec4.fromValues(pbr.baseColorFactor[0], pbr.baseColorFactor[1], pbr.baseColorFactor[2], pbr.baseColorFactor[3]);
        }

        if (pbr.metallicRoughnessTexture) {
            const uri = images![pbr.metallicRoughnessTexture.index].uri!;
            metallicRoughnessTexture = await getTexture(gl, `${dir}/${uri}`);
        }

        metallicFactor = pbr.metallicFactor !== undefined ? pbr.metallicFactor : 1.0;
        roughnessFactor = pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : 1.0;
    }

    if (material.emissiveTexture) {
        const uri = images![material.emissiveTexture.index].uri!;
        emissiveTexture = await getTexture(gl, `${dir}/${uri}`);
    }

    if (material.normalTexture) {
        const uri = images![material.normalTexture.index].uri!;
        normalTexture = await getTexture(gl, `${dir}/${uri}`);
    }

    if (material.occlusionTexture) {
        const uri = images![material.occlusionTexture.index].uri!;
        occlusionTexture = await getTexture(gl, `${dir}/${uri}`);
    }

    if (material.emissiveFactor) {
        emissiveFactor = vec3.fromValues(material.emissiveFactor[0], material.emissiveFactor[1], material.emissiveFactor[2])
    }


    return {
        baseColorTexture,
        baseColorFactor,
        metallicRoughnessTexture,
        metallicFactor,
        roughnessFactor,
        emissiveTexture,
        emissiveFactor,
        normalTexture,
        occlusionTexture,
    } as Material;
};

/**
 * Loads a GLTF model and its assets
 * @param gl Web GL context
 * @param uri URI to model
 */
const loadModel = async (gl: GLContext, uri: string) => {
    const response = await fetch(uri);
    const gltf = await response.json() as gltf.GlTf;

    if (gltf.accessors === undefined || gltf.accessors.length === 0) {
        throw new Error('GLTF File is missing accessors')
    }

    const buffers = await Promise.all(
        gltf.buffers!.map(async (b) => await getBuffer(uri, b.uri!)
        ));

    const scene = gltf.scenes![gltf.scene || 0];
    const meshes = gltf.meshes!.map(m => loadMesh(gl, gltf, m, buffers));
    const materials = gltf.materials ? await Promise.all(gltf.materials.map(async (m) => await loadMaterial(gl, m, uri, gltf.images))) : [];

    const rootNode = scene.nodes![0];
    const nodes = gltf.nodes!.map((n, i) => loadNodes(i, n));

    const animations = {} as Animation;
    gltf.animations?.forEach(anim => animations[anim.name as string] = loadAnimation(gltf, anim, buffers));

    const skins = gltf.skins ? gltf.skins.map(x => {
        const bindTransforms = readBufferFromFile(gltf, buffers, gltf.accessors![x.inverseBindMatrices!]);
        const inverseBindTransforms = x.joints.map((_, i) => createMat4FromArray(bindTransforms.data.slice(i * 16, i * 16 + 16)));

        return {
            joints: x.joints,
            inverseBindTransforms,
        };
    }) : [] as Skin[];

    const name = uri.split('/').slice(-1)[0];
    return {
        name,
        meshes,
        nodes,
        rootNode,
        animations,
        skins,
        materials,
    } as Model;
};


/**
 * Deletes GL buffers and textures
 * @param gl Web GL context
 * @param model Model to dispose
 */
const dispose = (gl: GLContext, model: Model) => {
    model.meshes.forEach(m => {
        gl.deleteBuffer(m.indices);
        if (m.joints) gl.deleteBuffer(m.joints.buffer);
        if (m.normals) gl.deleteBuffer(m.normals.buffer);
        if (m.positions) gl.deleteBuffer(m.positions.buffer);
        if (m.tangents) gl.deleteBuffer(m.tangents.buffer);
        if (m.texCoord) gl.deleteBuffer(m.texCoord.buffer);
        if (m.weights) gl.deleteBuffer(m.weights.buffer);

        m.indices = null
        m.joints = null;
        m.normals = null;
        m.tangents = null;
        m.texCoord = null;
        m.weights = null;
    });

    model.materials.forEach(m => {
        if (m.baseColorTexture) gl.deleteTexture(m.baseColorTexture);
        if (m.emissiveTexture) gl.deleteTexture(m.emissiveTexture);
        if (m.normalTexture) gl.deleteTexture(m.normalTexture);
        if (m.occlusionTexture) gl.deleteTexture(m.occlusionTexture);
        if (m.metallicRoughnessTexture) gl.deleteTexture(m.metallicRoughnessTexture);

        m.baseColorTexture = null;
        m.emissiveTexture = null;
        m.normalTexture = null;
        m.occlusionTexture = null;
        m.metallicRoughnessTexture = null;
    });
};

export {
    dispose, loadModel
};
