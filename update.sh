set -e

CC=gcc
CXX=g++

#(
#cd $HOME/z3
#git pull
#rm -rf build
#rm -rf $HOME/z3-install
#mkdir build
#cd build
#cmake .. -G Ninja
#ninja
#sudo ninja install
#)

(
cd $HOME/llvm-project
git pull || true
rm -rf build
mkdir build
cd build
cmake -G Ninja -DLLVM_ENABLE_RTTI=ON -DLLVM_ENABLE_EH=ON -DLLVM_BUILD_LLVM_DYLIB=ON -DCMAKE_BUILD_TYPE=Release  -DLLVM_ENABLE_ASSERTIONS=ON -DCMAKE_INSTALL_PREFIX=$HOME/llvm-install ../llvm -DLLVM_ENABLE_PROJECTS="llvm;lld;clang;compiler-rt" -DLLVM_ENABLE_RUNTIMES="libcxx;libcxxabi;libunwind" -DCMAKE_C_COMPILER=$CC -DCMAKE_CXX_COMPILER=$CXX
ninja
ninja install
)

(
export LD_LIBRARY_PATH=/home/ce/llvm-project/build/lib:$LD_LIBRARY_PATH
cd $HOME/alive2
git pull
rm -rf build-new
mkdir build-new
cd build-new
cmake .. -G Ninja -DBUILD_TV=1 -DBUILD_LLVM_UTILS=1 -DLLVM_DIR=$HOME/llvm-install/lib/cmake/llvm -DCMAKE_BUILD_TYPE=Release  -DCMAKE_C_COMPILER=$CC -DCMAKE_CXX_COMPILER=$CXX
ninja
ninja check || true # some cases always fail
)

echo
echo
echo 'Success: now move build-new to build'
echo
